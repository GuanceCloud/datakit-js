import { IncrementalSource, RecordType } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import * as replayStats from '../replayStats'
import {
  createMutationSerializerTask,
  SerializationContextStatus
} from '../record/serialize'
import { createSegment } from './segment'

describe('segment', () => {
  afterEach(() => {
    replayStats.resetReplayStats()
  })

  it('should collect records and flush segment metadata', () => {
    const encoder = {
      empty: true,
      isEmpty() {
        return this.empty
      },
      write: jasmine.createSpy('write').and.callFake((data, callback) => {
        encoder.empty = false
        if (callback) {
          callback(data.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          rawBytesCount: 64,
          outputBytesCount: 32,
          output: 'encoded-segment'
        })
      })
    }

    const segment = createSegment({
      encoder,
      creationReason: 'view_change',
      context: {
        application: { id: 'app-1' },
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }
    })
    const callback = jasmine.createSpy('callback')

    segment.addRecord(
      { type: RecordType.FullSnapshot, timestamp: 20, data: { node: 1 } },
      callback
    )
    segment.addRecord(
      { type: RecordType.IncrementalSnapshot, timestamp: 30, data: { node: 2 } },
      callback
    )

    segment.flush((metadata, encoderResult) => {
      expect(metadata).toEqual(
        jasmine.objectContaining({
          start: 20,
          end: 30,
          creation_reason: 'view_change',
          records_count: 2,
          has_full_snapshot: true,
          index_in_view: 0,
          source: 'browser',
          view: { id: 'view-1' }
        })
      )
      expect(encoderResult).toEqual(
        jasmine.objectContaining({
          rawBytesCount: 64,
          output: 'encoded-segment'
        })
      )
    })

    expect(callback.calls.count()).toBe(2)
    expect(callback.calls.argsFor(0)[0]).toBeGreaterThan(0)
    expect(callback.calls.argsFor(1)[0]).toBeGreaterThan(
      callback.calls.argsFor(0)[0]
    )
    expect(replayStats.getReplayStats('view-1')).toEqual(
      jasmine.objectContaining({
        records_count: 2,
        segments_count: 1,
        segments_total_raw_size: 64
      })
    )
  })

  it('should throw when flushing an empty segment', () => {
    const segment = createSegment({
      encoder: {
        isEmpty: () => true,
        write: jasmine.createSpy('write'),
        finish: jasmine.createSpy('finish')
      },
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })

    expect(() => {
      segment.flush(() => {})
    }).toThrowError('Empty segment flushed')
  })

  it('should preserve a synchronous footer write error in the flush result', () => {
    const footerError = new Error('footer write failed')
    let writeCount = 0
    const encoder = {
      write: jasmine
        .createSpy('write')
        .and.callFake((_data, callback) => {
          writeCount += 1
          if (callback) {
            callback(0, writeCount === 2 ? footerError : undefined)
          }
        }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          rawBytesCount: 0,
          outputBytesCount: 0,
          output: new Uint8Array(0)
        })
      })
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    let flushResult

    segment.addRecord(
      { type: RecordType.FullSnapshot, timestamp: 20 },
      () => {}
    )
    segment.flush((_metadata, encoderResult) => {
      flushResult = encoderResult
    })

    expect(flushResult.error).toBe(footerError)
  })

  it('should reject an oversized record before writing it to the encoder', () => {
    const encoder = {
      isEmpty: () => true,
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 101
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })

    const result = segment.addRecord(
      { type: RecordType.FullSnapshot, timestamp: 20 },
      () => {},
      100,
      10
    )

    expect(result.status).toBe('record_too_large')
    expect(result.estimatedBytesCount).toBeGreaterThan(10)
    expect(segment.isEmpty()).toBeTrue()
    expect(encoder.write).not.toHaveBeenCalled()
  })

  it('should use estimated bytes for admission and real bytes for correction', () => {
    const writeCallbacks = []
    const encoder = {
      isEmpty: () => false,
      write: jasmine
        .createSpy('write')
        .and.callFake((_data, callback) => writeCallbacks.push(callback)),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 5,
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })

    expect(
      segment.addRecord(
        { type: RecordType.IncrementalSnapshot, timestamp: 20 },
        () => {},
        12,
        1000
      ).status
    ).toBe('added')
    writeCallbacks[0](10)

    expect(
      segment.addRecord(
        { type: RecordType.IncrementalSnapshot, timestamp: 30 },
        () => {},
        12,
        1000
      )
    ).toEqual(
      jasmine.objectContaining({
        status: 'segment_full',
        estimatedBytesCount: 5,
        serializedRecordData: jasmine.any(String)
      })
    )
    expect(encoder.write).toHaveBeenCalledTimes(1)
  })

  it('should preflight a known large full snapshot before JSON serialization', () => {
    const encoder = {
      write: jasmine.createSpy('write').and.callFake((_data, callback) => {
        if (callback) {
          callback(1)
        }
      }),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: (data) =>
        typeof data === 'number' ? data : 1,
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    segment.addRecord({ type: RecordType.Meta, timestamp: 10 }, () => {})
    const root = document.createElement('div')
    root.setAttribute('data-payload', 'x'.repeat(70000))
    const serializerTask = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })
    expect(
      serializerTask.advance(
        Number.MAX_SAFE_INTEGER,
        50000,
        1024 * 1024
      )
    ).toBeTrue()
    const stringify = spyOn(JSON, 'stringify').and.callThrough()

    const result = segment.addRecord(
      {
        type: RecordType.FullSnapshot,
        timestamp: 20,
        data: { node: serializerTask.serializedNode }
      },
      () => {},
      60000,
      4 * 1024 * 1024
    )

    expect(result.status).toBe('segment_full')
    expect(stringify).not.toHaveBeenCalled()
    expect(encoder.write).toHaveBeenCalledTimes(1)
  })

  it('should keep a compressible full snapshot in the current segment', () => {
    const encoder = {
      write: jasmine.createSpy('write').and.callFake((_data, callback) => {
        if (callback) {
          callback(1)
        }
      }),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 1,
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    segment.addRecord({ type: RecordType.Meta, timestamp: 10 }, () => {})
    const root = document.createElement('div')
    root.setAttribute('data-payload', 'x'.repeat(70000))
    const serializerTask = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })
    expect(
      serializerTask.advance(
        Number.MAX_SAFE_INTEGER,
        50000,
        1024 * 1024
      )
    ).toBeTrue()

    const result = segment.addRecord(
      {
        type: RecordType.FullSnapshot,
        timestamp: 20,
        data: { node: serializerTask.serializedNode }
      },
      () => {},
      60000,
      4 * 1024 * 1024
    )

    expect(result.status).toBe('added')
    expect(encoder.write).toHaveBeenCalledTimes(2)
  })

  it('should reuse serialized record data when retrying in a fresh segment', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 100,
      getPendingRawBytesCount: () => 0
    }
    const firstSegment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    firstSegment.addRecord(
      { type: RecordType.Meta, timestamp: 10 },
      () => {},
      1000,
      10000
    )
    const retriedRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 20,
      data: { source: IncrementalSource.Scroll, id: 1, x: 2, y: 3 }
    }
    const stringify = spyOn(JSON, 'stringify').and.callThrough()
    const fullResult = firstSegment.addRecord(
      retriedRecord,
      () => {},
      150,
      10000
    )
    expect(fullResult.status).toBe('segment_full')
    expect(
      stringify.calls.allArgs().filter((args) => args[0] === retriedRecord)
        .length
    ).toBe(1)

    const nextSegment = createSegment({
      encoder,
      creationReason: 'segment_bytes_limit',
      context: {
        view: { id: 'view-1' }
      }
    })
    expect(
      nextSegment.addRecord(
        retriedRecord,
        () => {},
        150,
        10000,
        fullResult.serializedRecordData
      ).status
    ).toBe('added')
    expect(
      stringify.calls.allArgs().filter((args) => args[0] === retriedRecord)
        .length
    ).toBe(1)
  })

  it('should conservatively estimate already-compressed canvas records', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: jasmine
        .createSpy('estimateEncodedBytesCount')
        .and.returnValue(1),
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 20,
      data: {
        source: IncrementalSource.CanvasMutation,
        encodedBytesCount: 150,
        commands: [{ property: 'drawImage', args: ['A'.repeat(200)] }]
      }
    }
    const firstSerializedRecord =
      '{"records":[' + JSON.stringify(canvasRecord)

    expect(
      segment.addRecord(
        canvasRecord,
        () => {},
        firstSerializedRecord.length + 10,
        10000
      ).status
    ).toBe('added')
    expect(
      segment.addRecord(
        Object.assign({}, canvasRecord, { timestamp: 30 }),
        () => {},
        firstSerializedRecord.length + 10,
        10000
      ).status
    ).toBe('segment_full')
    expect(encoder.estimateEncodedBytesCount).not.toHaveBeenCalled()
    expect(encoder.write).toHaveBeenCalledTimes(1)
  })

  it('should reject an oversized encoded canvas record in an empty segment', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: jasmine
        .createSpy('estimateEncodedBytesCount')
        .and.returnValue(1),
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const encodedBytesCount = 80 * 1024
    const base64Length = Math.ceil((encodedBytesCount * 4) / 3)
    const result = segment.addRecord(
      {
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: {
          source: IncrementalSource.CanvasMutation,
          encodedBytesCount,
          commands: [
            {
              property: 'drawImage',
              args: ['A'.repeat(base64Length)]
            }
          ]
        }
      },
      () => {},
      60 * 1024,
      4 * 1024 * 1024
    )

    expect(result).toEqual(
      jasmine.objectContaining({
        status: 'record_too_large',
        estimatedBytesCount: jasmine.any(Number)
      })
    )
    expect(result.estimatedBytesCount).toBeGreaterThan(60 * 1024)
    expect(segment.isEmpty()).toBeTrue()
    expect(encoder.estimateEncodedBytesCount).not.toHaveBeenCalled()
    expect(encoder.write).not.toHaveBeenCalled()
  })

  it('should reject an oversized encoded canvas record without filling an existing segment', () => {
    const encoder = {
      write: jasmine.createSpy('write').and.callFake((_data, callback) => {
        if (callback) {
          callback(1)
        }
      }),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: jasmine
        .createSpy('estimateEncodedBytesCount')
        .and.returnValue(1),
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    segment.addRecord(
      { type: RecordType.FullSnapshot, timestamp: 10 },
      () => {},
      60 * 1024,
      4 * 1024 * 1024
    )
    const encodedBytesCount = 80 * 1024
    const result = segment.addRecord(
      {
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: {
          source: IncrementalSource.CanvasMutation,
          encodedBytesCount,
          commands: [
            {
              property: 'drawImage',
              args: [
                'A'.repeat(Math.ceil((encodedBytesCount * 4) / 3))
              ]
            }
          ]
        }
      },
      () => {},
      60 * 1024,
      4 * 1024 * 1024
    )

    expect(result.status).toBe('record_too_large')
    expect(segment.isEmpty()).toBeFalse()
    expect(encoder.write).toHaveBeenCalledTimes(1)
    expect(encoder.finish).not.toHaveBeenCalled()
  })

  it('should keep a compressible oversized non-canvas record eligible in an empty segment', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: jasmine
        .createSpy('estimateEncodedBytesCount')
        .and.returnValue(1000),
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const result = segment.addRecord(
      {
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: {
          source: IncrementalSource.StyleSheetRule,
          rule: 'x'.repeat(80 * 1024)
        }
      },
      () => {},
      60 * 1024,
      4 * 1024 * 1024
    )

    expect(result.status).toBe('added')
    expect(encoder.estimateEncodedBytesCount).toHaveBeenCalledTimes(1)
    expect(encoder.write).toHaveBeenCalledTimes(1)
  })

  it('should keep using the encoder estimate for canvas command records', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      estimateEncodedBytesCount: jasmine
        .createSpy('estimateEncodedBytesCount')
        .and.returnValue(5),
      getPendingRawBytesCount: () => 0
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })

    expect(
      segment.addRecord(
        {
          type: RecordType.IncrementalSnapshot,
          timestamp: 20,
          data: {
            source: IncrementalSource.CanvasMutation,
            commands: [{ property: 'fillRect', args: [0, 0, 10, 10] }]
          }
        },
        () => {},
        100,
        10000
      ).status
    ).toBe('added')
    expect(encoder.estimateEncodedBytesCount).toHaveBeenCalledTimes(1)
  })

  it('should reject a record while the asynchronous encoder backlog is full', () => {
    const encoder = {
      isEmpty: () => true,
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 11,
      getPendingRawBytesCount: () => 990
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })

    expect(
      segment.addRecord(
        { type: RecordType.IncrementalSnapshot, timestamp: 20 },
        () => {},
        100,
        1000
      )
    ).toEqual(
      jasmine.objectContaining({
        status: 'encoder_backpressure',
        estimatedBytesCount: jasmine.any(Number),
        serializedRecordData: jasmine.any(String)
      })
    )
    expect(encoder.write).not.toHaveBeenCalled()
  })

  it('should reuse serialized record data across encoder backpressure retries', () => {
    let pendingRawBytesCount = 990
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 11,
      getPendingRawBytesCount: () => pendingRawBytesCount
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const record = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 20,
      data: { source: IncrementalSource.Scroll, id: 1, x: 2, y: 3 }
    }
    const expectedSerializedRecordData = JSON.stringify(record)
    const stringify = spyOn(JSON, 'stringify').and.callThrough()

    const firstResult = segment.addRecord(
      record,
      () => {},
      100,
      1000
    )
    expect(firstResult.status).toBe('encoder_backpressure')
    expect(firstResult.serializedRecordData).toEqual(
      expectedSerializedRecordData
    )

    const secondResult = segment.addRecord(
      record,
      () => {},
      100,
      1000,
      firstResult.serializedRecordData
    )
    expect(secondResult.status).toBe('encoder_backpressure')
    expect(secondResult.serializedRecordData).toBe(
      firstResult.serializedRecordData
    )

    pendingRawBytesCount = 0
    expect(
      segment.addRecord(
        record,
        () => {},
        100,
        1000,
        secondResult.serializedRecordData
      ).status
    ).toBe('added')
    expect(
      stringify.calls.allArgs().filter((args) => args[0] === record).length
    ).toBe(1)
    expect(encoder.write).toHaveBeenCalledTimes(1)
  })

  it('should not let a full snapshot bypass the encoder backlog limit', () => {
    const encoder = {
      isEmpty: () => true,
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish'),
      estimateEncodedBytesCount: () => 11,
      getPendingRawBytesCount: () => 990
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })

    expect(
      segment.addRecord(
        { type: RecordType.FullSnapshot, timestamp: 20 },
        () => {},
        100,
        1000
      )
    ).toEqual(
      jasmine.objectContaining({
        status: 'encoder_backpressure',
        estimatedBytesCount: jasmine.any(Number)
      })
    )
    expect(encoder.write).not.toHaveBeenCalled()
  })

  it('should reject a giant string before JSON.stringify allocates it', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish')
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const stringify = spyOn(JSON, 'stringify').and.callThrough()

    const result = segment.addRecord(
      {
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: {
          source: IncrementalSource.StyleSheetRule,
          rule: 'x'.repeat(5 * 1024 * 1024)
        }
      },
      () => {},
      60000,
      4 * 1024 * 1024
    )

    expect(result.status).toBe('record_too_large')
    expect(stringify).not.toHaveBeenCalled()
    expect(encoder.write).not.toHaveBeenCalled()
  })

  it('should reject excessive record depth before JSON.stringify can overflow', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish')
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const record = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 20,
      data: {}
    }
    let current = record.data
    for (let depth = 0; depth < 1100; depth += 1) {
      current.child = {}
      current = current.child
    }
    const stringify = spyOn(JSON, 'stringify').and.callThrough()

    const result = segment.addRecord(
      record,
      () => {},
      60000,
      4 * 1024 * 1024
    )

    expect(result.status).toBe('record_too_large')
    expect(stringify).not.toHaveBeenCalled()
    expect(encoder.write).not.toHaveBeenCalled()
  })

  it('should turn an unsafe record getter into a bounded rejection', () => {
    const encoder = {
      write: jasmine.createSpy('write'),
      finish: jasmine.createSpy('finish')
    }
    const segment = createSegment({
      encoder,
      creationReason: 'initial',
      context: {
        view: { id: 'view-1' }
      }
    })
    const data = {}
    Object.defineProperty(data, 'unsafe', {
      enumerable: true,
      get() {
        throw new Error('unsafe getter')
      }
    })

    expect(() => {
      expect(
        segment.addRecord(
          {
            type: RecordType.IncrementalSnapshot,
            timestamp: 20,
            data
          },
          () => {},
          60000,
          4 * 1024 * 1024
        ).status
      ).toBe('record_too_large')
    }).not.toThrow()
    expect(encoder.write).not.toHaveBeenCalled()
  })
})
