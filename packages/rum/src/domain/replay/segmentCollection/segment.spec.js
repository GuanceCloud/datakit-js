import { RecordType } from '../../../types'
import * as replayStats from '../replayStats'
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
})
