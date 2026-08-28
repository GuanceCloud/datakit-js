import {
  LifeCycle,
  LifeCycleEventType,
  Observable,
  PageExitReason,
  resetTelemetry,
  startFakeTelemetry
} from '@cloudcare/browser-core'
import {
  computeSegmentContext,
  doStartSegmentCollection,
  SEGMENT_BYTES_LIMIT,
  SEGMENT_DURATION_LIMIT,
  setSegmentBytesLimit
} from './segmentCollection'
import { IncrementalSource, RecordType } from '../../../types'
import {
  createDeflateEncoder,
  DeflateEncoderStreamId
} from '../../deflate/deflateEncoder'
import {
  SESSION_REPLAY_TIME_ANCHOR_BACKPRESSURE_RESERVE,
  SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
  SESSION_REPLAY_TIME_ANCHOR_TAG
} from '../timeAnchor'

describe('segmentCollection', () => {
  let originalSegmentBytesLimit

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(0))
    originalSegmentBytesLimit = 60000
    setSegmentBytesLimit(originalSegmentBytesLimit)
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    setSegmentBytesLimit(originalSegmentBytesLimit)
  })

  function createEncoder() {
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
        encoder.empty = true
        callback({
          rawBytesCount: 100,
          output: new Uint8Array([1, 2, 3]),
          outputBytesCount: 3
        })
      }),
      estimateEncodedBytesCount: () => 1,
      getPendingEncodedBytesCount: () => 0,
      getPendingRawBytesCount: () => 0
    }
    return encoder
  }

  function createDeferredEncoder() {
    const pendingFinishes = []
    const encoder = {
      write: jasmine.createSpy('write').and.callFake((data, callback) => {
        if (callback) {
          callback(data.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        pendingFinishes.push(callback)
      }),
      estimateEncodedBytesCount: () => 1,
      getPendingEncodedBytesCount: () => 0,
      getPendingRawBytesCount: () => 0,
      resolve(index, result) {
        pendingFinishes[index](
          result || {
            rawBytesCount: 100,
            output: new Uint8Array([1, 2, 3]),
            outputBytesCount: 3
          }
        )
      }
    }
    return encoder
  }

  it('should compute segment context from session and view', () => {
    expect(
      computeSegmentContext(
        {
          sdkName: 'df_web_rum_sdk',
          sdkVersion: '1.0.0',
          applicationId: 'app-1',
          env: 'prod',
          service: 'fallback-service',
          version: 'fallback-version'
        },
        {
          findTrackedSession: () => ({ id: 'session-1' })
        },
        {
          findView: () => ({
            id: 'view-1',
            service: 'view-service',
            version: 'view-version'
          })
        }
      )
    ).toEqual({
      sdk: {
        name: 'df_web_rum_sdk',
        version: '1.0.0'
      },
      env: 'prod',
      service: 'view-service',
      version: 'view-version',
      app: {
        id: 'app-1'
      },
      session: {
        id: 'session-1'
      },
      view: {
        id: 'view-1'
      }
    })

    expect(
      computeSegmentContext(
        {},
        {
          findTrackedSession: () => undefined
        },
        {
          findView: () => ({ id: 'view-1' })
        }
      )
    ).toBeUndefined()
  })

  it('should flush a segment when a page-exit event occurs', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, { reason: 'before_unload' })

    expect(sendOnExit).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
  })

  it('should prepare pending records before flushing on page exit', () => {
    const lifeCycle = new LifeCycle()
    const callOrder = []
    const encoder = createEncoder()
    encoder.finish.and.callFake((callback) => {
      callOrder.push('flush')
      callback({
        rawBytesCount: 100,
        output: new Uint8Array([1]),
        outputBytesCount: 1
      })
    })
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        beforePageExitFlush: () => {
          callOrder.push('prepare')
        }
      }
    )

    segmentCollection.addRecord({ type: RecordType.FullSnapshot, timestamp: 10 })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.HIDDEN
    })

    expect(callOrder).toEqual(['prepare', 'flush'])
  })

  it('should retry pending records after synchronously draining encoder backpressure on unload', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const onSegmentFlushed = jasmine.createSpy('onSegmentFlushed')
    const pendingFinishes = []
    let pendingRawBytesCount = 0
    const encoder = {
      write: jasmine.createSpy('write').and.callFake((data, callback) => {
        if (callback) {
          callback(data.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        pendingFinishes.push(callback)
      }),
      estimateEncodedBytesCount: () => 1,
      getPendingEncodedBytesCount: () => 0,
      getPendingRawBytesCount: () => pendingRawBytesCount,
      flushPendingActionsSync: jasmine
        .createSpy('flushPendingActionsSync')
        .and.callFake(() => {
          pendingRawBytesCount = 0
          pendingFinishes.splice(0).forEach((callback) => {
            callback({
              rawBytesCount: 100,
              output: new Uint8Array([1, 2, 3]),
              outputBytesCount: 3
            })
          })
        })
    }
    const prepareResults = []
    let segmentCollection
    segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onSegmentFlushed,
        beforePageExitFlush: () => {
          prepareResults.push(
            segmentCollection.addRecord({
              type: RecordType.IncrementalSnapshot,
              timestamp: 20 + prepareResults.length
            })
          )
        }
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    pendingRawBytesCount = 1000

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })

    expect(prepareResults).toEqual([false, true])
    expect(encoder.flushPendingActionsSync).toHaveBeenCalledTimes(2)
    expect(encoder.finish).toHaveBeenCalledTimes(2)
    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(2)
    expect(
      onSegmentFlushed.calls.allArgs().map((args) => ({
        flushReason: args[0].flushReason,
        recordsCount: args[0].recordsCount
      }))
    ).toEqual([
      { flushReason: 'encoder_backpressure', recordsCount: 1 },
      { flushReason: PageExitReason.UNLOADING, recordsCount: 1 }
    ])
  })

  it('should flush a segment when the duration limit is reached', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should flush a segment when encoded bytes exceed the limit', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()
    setSegmentBytesLimit(5)

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10, value: 'x' })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should not send locked segments on view change until unlocked', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      true
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    expect(send).not.toHaveBeenCalled()

    segmentCollection.unlockSegment()
    expect(send).toHaveBeenCalledTimes(1)

    segmentCollection.addRecord({ type: 3, timestamp: 20 })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('should drain a hidden locked segment through the regular transport after unlock', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      createEncoder(),
      true
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.HIDDEN
    })

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).not.toHaveBeenCalled()

    segmentCollection.unlockSegment()

    expect(send).toHaveBeenCalledTimes(1)
    expect(sendOnExit).not.toHaveBeenCalled()
  })

  it('should flush immediately for canvas mutation records when configured', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false,
      { flushCanvasImmediately: true }
    )

    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 10,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    })

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should not flush immediately for canvas mutation records when not configured', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false,
      { flushCanvasImmediately: false }
    )

    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 10,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    })

    expect(send).not.toHaveBeenCalled()

    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should expose segment flush debug data when a segment is flushed', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const onSegmentFlushed = jasmine.createSpy('onSegmentFlushed')
    const encoder = createEncoder()

    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false,
      { flushCanvasImmediately: false, onSegmentFlushed }
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(onSegmentFlushed).toHaveBeenCalledWith({
      creationReason: 'init',
      flushReason: 'segment_duration_limit',
      recordsCount: 1,
      recordCountsByType: {
        full_snapshot: 1
      },
      start: 10,
      end: 10,
      indexInView: jasmine.any(Number),
      rawBytesCount: 100
    })
  })

  it('should keep a bounded rolling buffer while locked and send it only after unlock', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      true
    )

    for (let index = 0; index < 12; index += 1) {
      segmentCollection.addRecord({
        type:
          index === 0
            ? RecordType.FullSnapshot
            : RecordType.IncrementalSnapshot,
        timestamp: index
      })
      jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    }

    expect(send).not.toHaveBeenCalled()

    segmentCollection.unlockSegment()

    expect(send).toHaveBeenCalledTimes(12)
  })

  it('should replace an overflowing locked chain with a new full snapshot', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const onSegmentFlushed = jasmine.createSpy('onSegmentFlushed')
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      createEncoder(),
      true,
      { onSegmentFlushed, onReplayResetNeeded }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 0
    })
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    for (let timestamp = 1; timestamp <= 12; timestamp += 1) {
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp
      })
      jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    }
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith(
      'locked_buffer_capacity'
    )
    segmentCollection.unlockSegment()
    expect(send).not.toHaveBeenCalled()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 13
      })
    ).toBeFalse()

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 14
      })
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 15
      })
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    const flushedSegments = onSegmentFlushed.calls
      .allArgs()
      .map((args) => args[0])
    expect(send).toHaveBeenCalledTimes(2)
    expect(flushedSegments.map((segment) => segment.start)).toEqual([14, 15])
    expect(flushedSegments[0].recordCountsByType).toEqual({
      full_snapshot: 1
    })
  })

  it('should discard an open segment from the overflowing lock generation', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const onSegmentFlushed = jasmine.createSpy('onSegmentFlushed')
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      true,
      { onSegmentFlushed, onReplayResetNeeded }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 0
    })
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    for (let timestamp = 1; timestamp <= 12; timestamp += 1) {
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp
      })
      jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    }
    // This record is still in an open segment when the earlier asynchronous
    // results fill and overflow the locked buffer.
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 13
    })

    for (let index = 0; index <= 12; index += 1) {
      encoder.resolve(index)
    }
    segmentCollection.unlockSegment()
    encoder.resolve(13)
    jasmine.clock().tick(0)

    expect(send).not.toHaveBeenCalled()
    expect(onSegmentFlushed).not.toHaveBeenCalled()
    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith(
      'locked_buffer_capacity'
    )
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 14
      })
    ).toBeFalse()

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 15
      })
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    encoder.resolve(14)
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 16
      })
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    encoder.resolve(15)

    expect(send).toHaveBeenCalledTimes(2)
    expect(
      onSegmentFlushed.calls.allArgs().map((args) => args[0].start)
    ).toEqual([15, 16])
  })

  it('should send an open locked segment when it is unlocked before stop', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      createEncoder(),
      true
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.unlockSegment()
    segmentCollection.stop()

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should send an open locked segment on exit after it is unlocked', () => {
    const lifeCycle = new LifeCycle()
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send: jasmine.createSpy('send'), sendOnExit },
      createEncoder(),
      true
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.unlockSegment()
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })

    expect(sendOnExit).toHaveBeenCalledTimes(1)
  })

  it('should stay stopped when a stale page-exit callback runs after stop', () => {
    const subscribers = {}
    const lifeCycle = {
      subscribe(type, callback) {
        subscribers[type] = callback
        return {
          unsubscribe: jasmine.createSpy('unsubscribe')
        }
      }
    }
    const encoder = createEncoder()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const beforePageExitFlush = jasmine.createSpy('beforePageExitFlush')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false,
      { beforePageExitFlush }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.stop()
    const writesAfterStop = encoder.write.calls.count()
    const finishesAfterStop = encoder.finish.calls.count()

    subscribers[LifeCycleEventType.PAGE_EXITED]({
      reason: 'before_unload'
    })
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })

    expect(encoder.write.calls.count()).toBe(writesAfterStop)
    expect(encoder.finish.calls.count()).toBe(finishesAfterStop)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sendOnExit).not.toHaveBeenCalled()
    expect(beforePageExitFlush).toHaveBeenCalledTimes(1)
  })

  it('should discard the locked rolling buffer on buffer checkout', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const checkoutCallback = jasmine.createSpy('checkoutCallback')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      createEncoder(),
      true
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
    segmentCollection.addRecord({ type: 3, timestamp: 20 })
    segmentCollection.flushBufferSegment(checkoutCallback)
    segmentCollection.unlockSegment()

    expect(checkoutCallback).toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })

  it('should gate an unlocked checkout until its replacement baseline is admitted', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createDeferredEncoder()
    const flushedSegments = []
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      true,
      {
        onSegmentFlushed: (segment) => flushedSegments.push(segment)
      }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.flushBufferSegment(() => {
      segmentCollection.addRecord({
        type: RecordType.Meta,
        timestamp: 30
      })
      segmentCollection.addRecord({
        type: RecordType.Focus,
        timestamp: 30
      })
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 30
      })
    })
    segmentCollection.unlockSegment()

    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20
      })
    ).toBeFalse()
    expect(send).not.toHaveBeenCalled()

    encoder.resolve(0)
    expect(send).not.toHaveBeenCalled()
    encoder.resolve(1)

    expect(send).toHaveBeenCalledTimes(1)
    expect(flushedSegments.length).toBe(1)
    expect(flushedSegments[0].recordCountsByType).toEqual({
      meta: 1,
      focus: 1,
      full_snapshot: 1
    })
  })

  it('should stop admitting records when the asynchronous encoder backlog is full', () => {
    const lifeCycle = new LifeCycle()
    // Leave enough per-record headroom for the conservative serialization
    // preflight while starting close enough to the global backlog watermark
    // for the fourth record to be rejected.
    let pendingRawBytesCount = 800
    const encoder = {
      isEmpty: () => false,
      estimateEncodedBytesCount: () => 1,
      getPendingRawBytesCount: () => pendingRawBytesCount,
      write: jasmine.createSpy('write').and.callFake((data) => {
        pendingRawBytesCount += data.length * 2
      }),
      finish: jasmine.createSpy('finish')
    }
    setSegmentBytesLimit(1000)
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      { pendingRawBytesLimit: 1000 }
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    segmentCollection.addRecord({ type: 3, timestamp: 20 })
    segmentCollection.addRecord({ type: 3, timestamp: 30 })
    segmentCollection.addRecord({ type: 3, timestamp: 40 })

    // Three records are admitted. The fourth is rejected, and only the
    // closing metadata is posted while the previous raw strings are pending.
    expect(encoder.write).toHaveBeenCalledTimes(4)
  })

  it('should cap immediate canvas segment flushes to one per merge window', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      createEncoder(),
      false,
      { flushCanvasImmediately: true }
    )
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 10,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        commands: []
      }
    }

    segmentCollection.addRecord(canvasRecord)
    segmentCollection.addRecord({
      ...canvasRecord,
      timestamp: 20
    })

    expect(send).toHaveBeenCalledTimes(1)
    jasmine.clock().tick(249)
    expect(send).toHaveBeenCalledTimes(1)
    jasmine.clock().tick(1)
    expect(send).toHaveBeenCalledTimes(2)
  })

  it('should synchronously encode and send a segment before the unload handler returns', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const worker = {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY
    )
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({ type: 2, timestamp: 10 })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: 'before_unload'
    })

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(1)

    worker.listeners.message({
      data: {
        type: 'wrote',
        id: 0,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 1,
        result: new Uint8Array([1]),
        trailer: new Uint8Array([3])
      }
    })
    worker.listeners.message({
      data: {
        type: 'wrote',
        id: 1,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 1,
        result: new Uint8Array([2]),
        trailer: new Uint8Array([3])
      }
    })

    expect(sendOnExit).toHaveBeenCalledTimes(1)
  })

  it('should upgrade an already in-flight segment to sendOnExit during unload', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const worker = {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY
    )
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.stop(PageExitReason.UNLOADING)

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(1)

    worker.listeners.message({
      data: {
        type: 'wrote',
        id: 0,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 1,
        result: new Uint8Array([1]),
        trailer: new Uint8Array([3])
      }
    })
    worker.listeners.message({
      data: {
        type: 'wrote',
        id: 1,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 1,
        result: new Uint8Array([2]),
        trailer: new Uint8Array([3])
      }
    })

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(1)
  })

  it('should send a regular finalized segment that exceeds the beacon byte limit', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()
    const flushedSegments = []
    const onReplayResetNeeded = jasmine.createSpy(
      'onReplayResetNeeded'
    )
    setSegmentBytesLimit(2)
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false,
      {
        onReplayResetNeeded,
        onSegmentFlushed: (segment) => flushedSegments.push(segment)
      }
    )

    expect(
      segmentCollection.$rAddBaselineRecords([
        {
          type: RecordType.Meta,
          timestamp: 10,
          data: { width: 1280, height: 720 }
        },
        {
          type: RecordType.Focus,
          timestamp: 10,
          data: { has_focus: true }
        },
        {
          type: RecordType.FullSnapshot,
          timestamp: 10
        }
      ])
    ).toBeTrue()

    expect(send).toHaveBeenCalledTimes(1)
    expect(flushedSegments[0].recordCountsByType).toEqual({
      meta: 1,
      focus: 1,
      full_snapshot: 1
    })
    expect(onReplayResetNeeded).not.toHaveBeenCalled()

    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: {
          source: IncrementalSource.Mutation
        }
      })
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(send).toHaveBeenCalledTimes(2)
    expect(flushedSegments[1].recordCountsByType).toEqual({
      mutation: 1
    })
    expect(onReplayResetNeeded).not.toHaveBeenCalled()
  })

  it('should use sendOnExit when stop receives a page-exit reason', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      createEncoder(),
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.stop(PageExitReason.UNLOADING)

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(1)
  })

  it('should drain prior retry payloads on unload when the current segment is empty', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const drainOnExit = jasmine
      .createSpy('drainOnExit')
      .and.returnValue({
        $rBytesCount: 12000,
        $rAllPayloadsSent: true
      })
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit, $rDrainOnExit: drainOnExit },
      createEncoder(),
      false
    )

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    segmentCollection.stop(PageExitReason.UNLOADING)

    expect(drainOnExit).toHaveBeenCalledOnceWith(SEGMENT_BYTES_LIMIT)
    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).not.toHaveBeenCalled()
  })

  it('should drain prior retry payloads before rejecting an oversized unload tail', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const drainOnExit = jasmine
      .createSpy('drainOnExit')
      .and.returnValue({
        $rBytesCount: 10000,
        $rAllPayloadsSent: true
      })
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit, $rDrainOnExit: drainOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    encoder.resolve(0, {
      rawBytesCount: 50000,
      output: new Uint8Array(50000),
      outputBytesCount: 50000
    })

    expect(drainOnExit).toHaveBeenCalledOnceWith(SEGMENT_BYTES_LIMIT)
    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).not.toHaveBeenCalled()
  })

  it('should let a deferred segment finish asynchronously after a normal stop', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createDeferredEncoder()
    encoder.flushPendingActionsSync = jasmine
      .createSpy('flushPendingActionsSync')
      .and.callFake(() => encoder.resolve(0))
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.stop('manual_stop')

    expect(encoder.flushPendingActionsSync).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()

    encoder.resolve(0)

    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should preserve multiple real deflate groups over 60 KiB after a normal stop', () => {
    const listeners = {}
    const worker = {
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener: (type, listener) => {
        listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY
    )
    const flushPendingActionsSync = spyOn(
      encoder,
      'flushPendingActionsSync'
    ).and.callThrough()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const lifeCycle = new LifeCycle()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false,
      {
        // Mirrors a final anchor that could not be admitted. A normal stop must
        // not synchronously consume and clear older shared encoder groups.
        beforePageExitFlush: () => false
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10,
        data: { value: 'a'.repeat(40000) }
      })
    ).toBeTrue()
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: { value: 'b'.repeat(40000) }
      })
    ).toBeTrue()
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    const pendingRawBytesBeforeStop = encoder.getPendingRawBytesCount()
    expect(pendingRawBytesBeforeStop).toBeGreaterThan(SEGMENT_BYTES_LIMIT)

    segmentCollection.stop('manual_stop')

    expect(flushPendingActionsSync).not.toHaveBeenCalled()
    expect(encoder.getPendingRawBytesCount()).toBe(pendingRawBytesBeforeStop)
    expect(send).not.toHaveBeenCalled()

    for (let id = 0; id < 4; id += 1) {
      listeners.message({
        data: {
          type: 'wrote',
          id,
          streamId: DeflateEncoderStreamId.REPLAY,
          additionalBytesCount: 1,
          result: new Uint8Array([id + 1]),
          trailer: new Uint8Array([9])
        }
      })
    }

    expect(send).toHaveBeenCalledTimes(2)
    expect(sendOnExit).not.toHaveBeenCalled()
    expect(encoder.getPendingRawBytesCount()).toBe(0)
  })

  it('should keep async encoder boundaries ordered across recorder generations', () => {
    const listeners = {}
    const worker = {
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener: (type, listener) => {
        listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
    const encoder = createDeflateEncoder(
      worker,
      DeflateEncoderStreamId.REPLAY
    )
    const send = jasmine.createSpy('send')
    const request = {
      send,
      sendOnExit: jasmine.createSpy('sendOnExit')
    }
    const startCollection = (sessionId) =>
      doStartSegmentCollection(
        new LifeCycle(),
        () => ({
          session: { id: sessionId },
          view: { id: 'view-1' }
        }),
        request,
        encoder,
        false
      )

    const firstCollection = startCollection('session-1')
    firstCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    firstCollection.stop('session_expire')
    const secondCollection = startCollection('session-2')
    secondCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 20
    })
    secondCollection.stop('manual_stop')

    expect(
      worker.postMessage.calls.allArgs().map((args) => args[0].action)
    ).toEqual(['write', 'write', 'reset', 'write', 'write', 'reset'])
    expect(send).not.toHaveBeenCalled()

    listeners.message({
      data: {
        type: 'wrote',
        id: 0,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 5,
        result: new Uint8Array([1]),
        trailer: new Uint8Array([9])
      }
    })
    expect(send).not.toHaveBeenCalled()
    listeners.message({
      data: {
        type: 'wrote',
        id: 1,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 5,
        result: new Uint8Array([2]),
        trailer: new Uint8Array([3])
      }
    })
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.calls.argsFor(0)[0].data.get('session_id')).toBe(
      'session-1'
    )

    listeners.message({
      data: {
        type: 'wrote',
        id: 2,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 5,
        result: new Uint8Array([4]),
        trailer: new Uint8Array([9])
      }
    })
    expect(send).toHaveBeenCalledTimes(1)
    listeners.message({
      data: {
        type: 'wrote',
        id: 3,
        streamId: DeflateEncoderStreamId.REPLAY,
        additionalBytesCount: 5,
        result: new Uint8Array([5]),
        trailer: new Uint8Array([6])
      }
    })
    expect(send).toHaveBeenCalledTimes(2)
    expect(send.calls.argsFor(1)[0].data.get('session_id')).toBe(
      'session-2'
    )
  })

  it('should finalize but not send a mandatory recovery tail when its baseline is abandoned', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const encoder = createEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    segmentCollection.$rBeginMandatoryRecovery()
    segmentCollection.$rDiscardMandatoryRecovery()

    expect(encoder.finish).toHaveBeenCalledTimes(1)
    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).not.toHaveBeenCalled()

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 30
    })
    segmentCollection.stop()

    expect(encoder.finish).toHaveBeenCalledTimes(2)
    expect(send).toHaveBeenCalledTimes(1)
    expect(sendOnExit).not.toHaveBeenCalled()
  })

  it('should only release a held recovery tail after its replacement baseline is admitted', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const encoder = createEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    segmentCollection.$rBeginMandatoryRecovery()

    expect(send).not.toHaveBeenCalled()
    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 30
    })

    expect(encoder.finish).toHaveBeenCalledTimes(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('should remain stopped after discarding a held mandatory recovery tail', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.$rBeginMandatoryRecovery()
    segmentCollection.stop()

    expect(encoder.finish).toHaveBeenCalledTimes(1)
    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 20
      })
    ).toBeFalse()
  })

  it('should notify recovery after an asynchronously discarded mandatory tail drains encoder backpressure', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createDeferredEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded
      }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    segmentCollection.$rBeginMandatoryRecovery()
    pendingRawBytesCount = 990

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 30
      })
    ).toBeFalse()
    expect(onReplayResetNeeded).not.toHaveBeenCalled()

    pendingRawBytesCount = 0
    encoder.resolve(0)
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith(
      'full_snapshot_encoder_backpressure'
    )
  })

  it('should not exhaust recovery on repeated transient full snapshot backpressure', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    let pendingRawBytesCount = 990
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    const onReplayResetExhausted = jasmine.createSpy(
      'onReplayResetExhausted'
    )
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded: jasmine.createSpy('onReplayResetNeeded'),
        onReplayResetExhausted
      }
    )

    for (let attempt = 0; attempt < 4; attempt += 1) {
      expect(
        segmentCollection.addRecord({
          type: RecordType.FullSnapshot,
          timestamp: 10 + attempt
        })
      ).toBeFalse()
      expect(
        segmentCollection.$rWasLastAddRecordBackpressured()
      ).toBeTrue()
    }

    expect(onReplayResetExhausted).not.toHaveBeenCalled()
    pendingRawBytesCount = 0
    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 20
      })
    ).toBeTrue()
  })

  it('should gate a replay generation after a permanent transport drop', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const send = jasmine.createSpy('send').and.callFake((payload) => {
      if (send.calls.count() === 1) {
        payload.$rOnPermanentDrop('queue_full')
      }
    })
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      createEncoder(),
      false,
      { onReplayResetNeeded }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith(
      'transport_queue_full'
    )
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20
      })
    ).toBeFalse()
    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 30
      })
    ).toBeTrue()
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    expect(send).toHaveBeenCalledTimes(2)
  })

  it('should isolate a stopped collection late transport callback from a new collection', () => {
    const payloads = []
    const request = {
      send: (payload) => payloads.push(payload),
      sendOnExit: jasmine.createSpy('sendOnExit')
    }
    const firstLifeCycle = new LifeCycle()
    const firstCollection = doStartSegmentCollection(
      firstLifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      request,
      createEncoder(),
      false
    )
    firstCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    firstLifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    firstCollection.stop('session_expire')

    const secondLifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const secondCollection = doStartSegmentCollection(
      secondLifeCycle,
      () => ({
        session: { id: 'session-2' },
        view: { id: 'view-2' }
      }),
      request,
      createEncoder(),
      false,
      { onReplayResetNeeded }
    )
    secondCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 20
    })
    secondLifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    payloads[0].$rOnPermanentDrop('retry_exhausted')
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).not.toHaveBeenCalled()
    expect(
      secondCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 30
      })
    ).toBeTrue()
  })

  it('should request a new full snapshot and gate incrementals after dropping a full snapshot', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10,
        value: 'x'.repeat(600)
      })
    ).toBeFalse()
    const writesAfterDroppedSnapshot = encoder.write.calls.count()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20
      })
    ).toBeFalse()
    expect(
      segmentCollection.$rWasLastAddRecordBackpressured()
    ).toBeFalse()
    jasmine.clock().tick(0)

    expect(encoder.write.calls.count()).toBe(writesAfterDroppedSnapshot)
    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith(
      'full_snapshot_too_large'
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 30
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 40
      })
    ).toBeTrue()

    expect(encoder.write.calls.count()).toBeGreaterThan(
      writesAfterDroppedSnapshot
    )
  })

  it('should keep Meta and Focus with a replacement full snapshot', () => {
    const lifeCycle = new LifeCycle()
    const flushedSegments = []
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      createEncoder(),
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded: jasmine.createSpy('onReplayResetNeeded'),
        onSegmentFlushed: (segment) => flushedSegments.push(segment)
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10,
        value: 'x'.repeat(600)
      })
    ).toBeFalse()
    jasmine.clock().tick(0)

    expect(
      segmentCollection.addRecord({
        type: RecordType.Meta,
        timestamp: 20,
        data: { width: 1280, height: 720 }
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: RecordType.Focus,
        timestamp: 20,
        data: { has_focus: true }
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 20
      })
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(flushedSegments.length).toBe(1)
    expect(flushedSegments[0].recordCountsByType).toEqual({
      meta: 1,
      focus: 1,
      full_snapshot: 1
    })
  })

  ;['Meta', 'Focus', 'FullSnapshot'].forEach(
    (failingRecordName, failingWriteIndex) => {
      it(
        'should reject the baseline transaction when ' +
          failingRecordName +
          ' encoding fails synchronously',
        () => {
          const lifeCycle = new LifeCycle()
          const encoder = createEncoder()
          let writeIndex = 0
          encoder.write.and.callFake((data, callback) => {
            encoder.empty = false
            const currentWriteIndex = writeIndex
            writeIndex += 1
            if (!callback) {
              return
            }
            if (
              currentWriteIndex % (failingWriteIndex + 1) ===
              failingWriteIndex
            ) {
              callback(0, new Error('synchronous encoder failure'))
            } else {
              callback(data.length)
            }
          })
          const onReplayResetNeeded = jasmine.createSpy(
            'onReplayResetNeeded'
          )
          const onReplayResetExhausted = jasmine.createSpy(
            'onReplayResetExhausted'
          )
          const segmentCollection = doStartSegmentCollection(
            lifeCycle,
            () => ({
              session: { id: 'session-1' },
              view: { id: 'view-1' }
            }),
            {
              send: jasmine.createSpy('send'),
              sendOnExit: jasmine.createSpy('sendOnExit')
            },
            encoder,
            false,
            {
              onReplayResetNeeded,
              onReplayResetExhausted
            }
          )

          for (let attemptIndex = 0; attemptIndex < 3; attemptIndex += 1) {
            let accepted
            expect(() => {
              accepted = segmentCollection.$rAddBaselineRecords([
                {
                  type: RecordType.Meta,
                  timestamp: 10 + attemptIndex,
                  data: { width: 1280, height: 720 }
                },
                {
                  type: RecordType.Focus,
                  timestamp: 10 + attemptIndex,
                  data: { has_focus: true }
                },
                {
                  type: RecordType.FullSnapshot,
                  timestamp: 10 + attemptIndex
                }
              ])
            }).not.toThrow()
            expect(accepted).toBeFalse()
            if (attemptIndex < 2) {
              jasmine.clock().tick(0)
              expect(onReplayResetNeeded).toHaveBeenCalledTimes(
                attemptIndex + 1
              )
            }
          }

          expect(encoder.write).toHaveBeenCalledTimes(
            (failingWriteIndex + 1) * 3
          )
          expect(onReplayResetNeeded.calls.allArgs()).toEqual([
            ['encoder_error'],
            ['encoder_error']
          ])
          expect(onReplayResetExhausted).toHaveBeenCalledOnceWith(
            'encoder_error'
          )
        }
      )
    }
  )

  it('should replay the whole baseline transaction when its prelude fills the segment', () => {
    setSegmentBytesLimit(2)
    const lifeCycle = new LifeCycle()
    const flushedSegments = []
    spyOn(JSON, 'stringify').and.callThrough()
    const encoder = createEncoder()
    encoder.write.and.callFake((_data, callback) => {
      encoder.empty = false
      if (callback) {
        callback(1)
      }
    })
    encoder.finish.and.callFake((callback) => {
      encoder.empty = true
      callback({
        rawBytesCount: 1,
        output: new Uint8Array([1]),
        outputBytesCount: 1
      })
    })
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        onReplayResetNeeded: jasmine.createSpy('onReplayResetNeeded'),
        onSegmentFlushed: (segment) => flushedSegments.push(segment)
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 11
      })
    ).toBeTrue()

    const replacementFullSnapshot = {
      type: RecordType.FullSnapshot,
      timestamp: 20
    }
    expect(
      segmentCollection.$rAddBaselineRecords([
        {
          type: RecordType.Meta,
          timestamp: 20,
          data: { width: 1280, height: 720 }
        },
        {
          type: RecordType.Focus,
          timestamp: 20,
          data: { has_focus: true }
        },
        replacementFullSnapshot
      ])
    ).toBeTrue()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(flushedSegments.length).toBe(2)
    expect(flushedSegments[1].recordCountsByType).toEqual({
      meta: 1,
      focus: 1,
      full_snapshot: 1
    })
    expect(
      flushedSegments.some(
        (segment) =>
          segment.recordCountsByType.meta &&
          !segment.recordCountsByType.full_snapshot
      )
    ).toBeFalse()
    // Existing segment, discarded prelude attempt, successful transaction.
    expect(encoder.finish).toHaveBeenCalledTimes(3)
    expect(
      JSON.stringify.calls
        .allArgs()
        .filter((args) => args[0] === replacementFullSnapshot).length
    ).toBe(1)
  })

  it('should discard a rejected baseline transaction without sending its prelude', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const flushedSegments = []
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      createEncoder(),
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded: jasmine.createSpy('onReplayResetNeeded'),
        onSegmentFlushed: (segment) => flushedSegments.push(segment)
      }
    )

    expect(segmentCollection.flushBufferSegment()).toBeTrue()
    expect(
      segmentCollection.$rAddBaselineRecords([
        {
          type: RecordType.Meta,
          timestamp: 20,
          data: { width: 1280, height: 720 }
        },
        {
          type: RecordType.Focus,
          timestamp: 20,
          data: { has_focus: true }
        },
        {
          type: RecordType.FullSnapshot,
          timestamp: 20,
          value: 'x'.repeat(600)
        }
      ])
    ).toBeFalse()
    jasmine.clock().tick(SEGMENT_DURATION_LIMIT)

    expect(send).not.toHaveBeenCalled()
    expect(flushedSegments).toEqual([])
    expect(segmentCollection.flushBufferSegment()).toBeTrue()
    expect(
      segmentCollection.$rAddBaselineRecords([
        {
          type: RecordType.Meta,
          timestamp: 30,
          data: { width: 1280, height: 720 }
        },
        {
          type: RecordType.Focus,
          timestamp: 30,
          data: { has_focus: true }
        },
        {
          type: RecordType.FullSnapshot,
          timestamp: 30
        }
      ])
    ).toBeTrue()
    expect(send).toHaveBeenCalledTimes(1)
    expect(flushedSegments[0].recordCountsByType).toEqual({
      meta: 1,
      focus: 1,
      full_snapshot: 1
    })
  })

  it('should locally reject an oversized incremental without requesting a baseline reset', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        value: 'x'.repeat(600)
      })
    ).toBeFalse()
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).not.toHaveBeenCalled()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 30
      })
    ).toBeTrue()
    expect(
      segmentCollection.$rWasLastAddRecordBackpressured()
    ).toBeFalse()
  })

  it('should reject an oversized first canvas record and recover with a smaller frame', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createEncoder()
    const send = jasmine.createSpy('send')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send,
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      { onReplayResetNeeded }
    )
    const oversizedEncodedBytesCount = 80 * 1024
    const oversizedBase64Length = Math.ceil(
      (oversizedEncodedBytesCount * 4) / 3
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20,
        data: {
          source: IncrementalSource.CanvasMutation,
          encodedBytesCount: oversizedEncodedBytesCount,
          commands: [
            {
              property: 'drawImage',
              args: ['A'.repeat(oversizedBase64Length)]
            }
          ]
        }
      })
    ).toBeFalse()
    const writesAfterOversizedFrame = encoder.write.calls.count()

    expect(onReplayResetNeeded).not.toHaveBeenCalled()
    expect(encoder.finish).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 30,
        data: {
          source: IncrementalSource.CanvasMutation,
          encodedBytesCount: 3,
          commands: [
            {
              property: 'drawImage',
              args: ['QUJD']
            }
          ]
        }
      })
    ).toBeTrue()
    expect(encoder.write.calls.count()).toBe(writesAfterOversizedFrame + 1)
  })

  it('should recover after synchronously rejecting an incremental for encoder backpressure', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    pendingRawBytesCount = 950
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 20
      })
    ).toBeFalse()
    expect(
      segmentCollection.$rWasLastAddRecordBackpressured()
    ).toBeTrue()
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).not.toHaveBeenCalled()
    pendingRawBytesCount = 0
    const writesBeforeRecovery = encoder.write.calls.count()
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 30
      })
    ).toBeTrue()
    expect(
      segmentCollection.$rWasLastAddRecordBackpressured()
    ).toBeFalse()
    expect(encoder.write.calls.count()).toBeGreaterThan(writesBeforeRecovery)
  })

  it('should admit only the fixed internal time anchor through a bounded encoder reserve', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    pendingRawBytesCount = 950
    expect(
      segmentCollection.addRecord({
        type: SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
        timestamp: 20,
        data: {
          tag: SESSION_REPLAY_TIME_ANCHOR_TAG,
          payload: {}
        }
      })
    ).toBeTrue()
    expect(
      segmentCollection.$rWasLastAddRecordBackpressured()
    ).toBeFalse()
    jasmine.clock().tick(0)
    expect(onReplayResetNeeded).not.toHaveBeenCalled()

    pendingRawBytesCount =
      1000 + SESSION_REPLAY_TIME_ANCHOR_BACKPRESSURE_RESERVE
    expect(
      segmentCollection.addRecord({
        type: SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
        timestamp: 25,
        data: {
          tag: SESSION_REPLAY_TIME_ANCHOR_TAG,
          payload: {}
        }
      })
    ).toBeFalse()
    expect(
      segmentCollection.$rWasLastAddRecordBackpressured()
    ).toBeTrue()
    jasmine.clock().tick(0)
    expect(onReplayResetNeeded).not.toHaveBeenCalled()

    // Keep the exemption exact: another non-incremental record still protects
    // the replay chain through the existing baseline recovery.
    pendingRawBytesCount = 0
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 30
      })
    ).toBeTrue()
    pendingRawBytesCount = 950
    expect(
      segmentCollection.addRecord({
        type: RecordType.Focus,
        timestamp: 40,
        data: { has_focus: true }
      })
    ).toBeFalse()
    pendingRawBytesCount = 0
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 50
      })
    ).toBeFalse()
  })

  it('should reject an oversized same-tag Custom record and invalidate the baseline', () => {
    const lifeCycle = new LifeCycle()
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      createEncoder(),
      false,
      {
        pendingRawBytesLimit: 1000,
        onReplayResetNeeded
      }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    expect(
      segmentCollection.addRecord({
        type: SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
        timestamp: 20,
        data: {
          tag: SESSION_REPLAY_TIME_ANCHOR_TAG,
          payload: {},
          padding: 'x'.repeat(5000)
        }
      })
    ).toBeFalse()
    jasmine.clock().tick(0)

    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith('record_too_large')
    expect(
      segmentCollection.addRecord({
        type: RecordType.IncrementalSnapshot,
        timestamp: 30
      })
    ).toBeFalse()
  })

  it('should stringify the same backpressured record only once across retries', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      { pendingRawBytesLimit: 1000 }
    )

    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
    ).toBeTrue()
    const record = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 20,
      data: { source: IncrementalSource.Scroll, id: 1, x: 2, y: 3 }
    }
    const stringify = spyOn(JSON, 'stringify').and.callThrough()
    pendingRawBytesCount = 950

    expect(segmentCollection.addRecord(record)).toBeFalse()
    expect(segmentCollection.addRecord(record)).toBeFalse()
    pendingRawBytesCount = 0
    expect(segmentCollection.addRecord(record)).toBeTrue()

    expect(
      stringify.calls.allArgs().filter((args) => args[0] === record).length
    ).toBe(1)
  })

  it('should hold dependent segments until their full snapshot is finalized', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const onSegmentFlushed = jasmine.createSpy('onSegmentFlushed')
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false,
      { onSegmentFlushed }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 30
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    encoder.resolve(2)
    encoder.resolve(1)
    expect(send).not.toHaveBeenCalled()

    encoder.resolve(0)
    expect(send).toHaveBeenCalledTimes(3)
    expect(
      onSegmentFlushed.calls.allArgs().map((args) => args[0].start)
    ).toEqual([10, 20, 30])
  })

  ;[
    PageExitReason.HIDDEN,
    PageExitReason.FROZEN,
    PageExitReason.PAGEHIDE
  ].forEach((pageExitReason) => {
    it(
      'should upgrade a completed pending dependent segment on ' +
        pageExitReason,
      () => {
        const lifeCycle = new LifeCycle()
        const send = jasmine.createSpy('send')
        const sendOnExit = jasmine.createSpy('sendOnExit')
        const encoder = createDeferredEncoder()
        const segmentCollection = doStartSegmentCollection(
          lifeCycle,
          () => ({
            session: { id: 'session-1' },
            view: { id: 'view-1' }
          }),
          { send, sendOnExit },
          encoder,
          false
        )

        segmentCollection.addRecord({
          type: RecordType.FullSnapshot,
          timestamp: 10
        })
        lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
        segmentCollection.addRecord({
          type: RecordType.IncrementalSnapshot,
          timestamp: 20
        })
        lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

        // Complete the dependent first so it leaves the encoder in-flight set
        // and waits for its baseline generation.
        encoder.resolve(1)
        expect(send).not.toHaveBeenCalled()
        expect(sendOnExit).not.toHaveBeenCalled()

        lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
          reason: pageExitReason
        })
        encoder.resolve(0)

        expect(send).not.toHaveBeenCalled()
        expect(sendOnExit).toHaveBeenCalledTimes(2)
      }
    )
  })

  it('should send a completed dependent segment through the exit transport after unload', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    encoder.resolve(1)
    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).not.toHaveBeenCalled()

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    encoder.resolve(0)

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(2)
  })

  it('should send only the ordered prefix that fits the unload delivery budget', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const onSegmentFlushed = jasmine.createSpy('onSegmentFlushed')
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false,
      { onSegmentFlushed }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 30
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    const makeEncoderResult = (bytesCount) => ({
      rawBytesCount: bytesCount,
      output: new Uint8Array(bytesCount),
      outputBytesCount: bytesCount
    })
    encoder.resolve(2, makeEncoderResult(20000))
    encoder.resolve(1, makeEncoderResult(40000))
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    encoder.resolve(0, makeEncoderResult(30000))

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(1)
    expect(
      sendOnExit.calls.allArgs().map((args) => args[0].bytesCount)
    ).toEqual([30000])
    expect(
      onSegmentFlushed.calls.allArgs().map((args) => args[0].start)
    ).toEqual([10, 20, 30])
    expect(
      segmentCollection.getBaselineGenerationStateCountForDebug()
    ).toBe(1)
  })

  it('should include promoted transport bytes and report a dropped current unload segment', () => {
    const telemetryEvents = startFakeTelemetry()
    try {
      const lifeCycle = new LifeCycle()
      const send = jasmine.createSpy('send')
      const sendOnExit = jasmine
        .createSpy('sendOnExit')
        .and.returnValue({
          $rBytesCount: 55000,
          $rCurrentPayloadSent: false
        })
      const encoder = createDeferredEncoder()
      const segmentCollection = doStartSegmentCollection(
        lifeCycle,
        () => ({
          session: { id: 'session-1' },
          view: { id: 'view-1' }
        }),
        { send, sendOnExit },
        encoder,
        false
      )

      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 10
      })
      lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
        reason: PageExitReason.UNLOADING
      })
      encoder.resolve(0, {
        rawBytesCount: 10000,
        output: new Uint8Array(10000),
        outputBytesCount: 10000
      })

      expect(send).not.toHaveBeenCalled()
      expect(sendOnExit).toHaveBeenCalledTimes(1)
      expect(sendOnExit.calls.argsFor(0)[1]).toBe(SEGMENT_BYTES_LIMIT)
      expect(telemetryEvents).toContain(
        jasmine.objectContaining({
          message: 'Session Replay record discarded.',
          reason: 'page_exit_delivery_budget',
          estimated_bytes_count: 12048
        })
      )
    } finally {
      resetTelemetry()
    }
  })

  it('should reserve multipart envelope bytes for every unload segment', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const sendOnExit = jasmine.createSpy('sendOnExit')
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit },
      encoder,
      false
    )

    for (let index = 0; index < 8; index += 1) {
      segmentCollection.addRecord({
        type:
          index === 0
            ? RecordType.FullSnapshot
            : RecordType.IncrementalSnapshot,
        timestamp: (index + 1) * 10
      })
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    }

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    const encoderResult = {
      rawBytesCount: 7000,
      output: new Uint8Array(7000),
      outputBytesCount: 7000
    }
    for (let index = 1; index < 8; index += 1) {
      encoder.resolve(index, encoderResult)
    }
    encoder.resolve(0, encoderResult)

    expect(send).not.toHaveBeenCalled()
    expect(sendOnExit).toHaveBeenCalledTimes(6)
    expect(
      sendOnExit.calls.allArgs().map((args) => args[0].bytesCount)
    ).toEqual([7000, 7000, 7000, 7000, 7000, 7000])
  })

  it('should discard in-flight dependents when their full snapshot fails', () => {
    const lifeCycle = new LifeCycle()
    const send = jasmine.createSpy('send')
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const encoder = createDeferredEncoder()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false,
      { onReplayResetNeeded }
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.IncrementalSnapshot,
      timestamp: 20
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    encoder.resolve(1)
    encoder.resolve(0, {
      rawBytesCount: 100,
      output: new Uint8Array(),
      outputBytesCount: 0,
      error: new Error('failed')
    })
    jasmine.clock().tick(0)

    expect(send).not.toHaveBeenCalled()
    expect(onReplayResetNeeded).toHaveBeenCalledOnceWith('encoder_error')
  })

  it('should stop collecting after three consecutive full snapshot failures', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    encoder.finish.and.callFake((callback) => {
      callback({
        rawBytesCount: 0,
        output: new Uint8Array(),
        outputBytesCount: 0,
        error: new Error('failed')
      })
    })
    const onReplayResetNeeded = jasmine.createSpy('onReplayResetNeeded')
    const onReplayResetExhausted = jasmine.createSpy(
      'onReplayResetExhausted'
    )
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        onReplayResetNeeded,
        onReplayResetExhausted
      }
    )
    const fullSnapshot = {
      type: RecordType.FullSnapshot,
      timestamp: 10
    }

    segmentCollection.addRecord(fullSnapshot)
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    jasmine.clock().tick(0)
    segmentCollection.addRecord({ ...fullSnapshot, timestamp: 20 })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    jasmine.clock().tick(0)
    segmentCollection.addRecord({ ...fullSnapshot, timestamp: 30 })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    const writesAfterFailureLimit = encoder.write.calls.count()
    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 40
    })

    expect(onReplayResetNeeded).toHaveBeenCalledTimes(2)
    expect(onReplayResetExhausted).toHaveBeenCalledOnceWith(
      'encoder_error'
    )
    expect(encoder.write.calls.count()).toBe(writesAfterFailureLimit)
  })

  it('should discard an active dependent segment when asynchronous recovery is exhausted', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createDeferredEncoder()
    const onReplayResetExhausted = jasmine.createSpy(
      'onReplayResetExhausted'
    )
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      encoder,
      false,
      {
        onReplayResetNeeded: jasmine.createSpy('onReplayResetNeeded'),
        onReplayResetExhausted
      }
    )

    for (let attempt = 0; attempt < 3; attempt += 1) {
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: attempt * 10 + 10
      })
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
      if (attempt === 2) {
        segmentCollection.addRecord({
          type: RecordType.IncrementalSnapshot,
          timestamp: 35
        })
      }
      encoder.resolve(attempt, {
        rawBytesCount: 100,
        output: new Uint8Array(),
        outputBytesCount: 0,
        error: new Error('failed')
      })
      jasmine.clock().tick(0)
    }

    // Three failed baseline finishes plus the discard boundary for the
    // dependent segment that was active when the last callback arrived.
    expect(encoder.finish).toHaveBeenCalledTimes(4)
    expect(onReplayResetExhausted).toHaveBeenCalledOnceWith(
      'encoder_error'
    )
    expect(
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: 40
      })
    ).toBeFalse()
    encoder.resolve(3)
  })

  it('should release completed baseline generation state across many view snapshots', () => {
    const lifeCycle = new LifeCycle()
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      createEncoder(),
      false
    )

    for (let generation = 1; generation <= 100; generation += 1) {
      segmentCollection.addRecord({
        type: RecordType.FullSnapshot,
        timestamp: generation
      })
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
      expect(
        segmentCollection.getBaselineGenerationStateCountForDebug()
      ).toBe(1)
    }
  })

  it('should retain an old baseline generation until its asynchronous segment finishes', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createDeferredEncoder()
    const send = jasmine.createSpy('send')
    const segmentCollection = doStartSegmentCollection(
      lifeCycle,
      () => ({
        session: { id: 'session-1' },
        view: { id: 'view-1' }
      }),
      { send, sendOnExit: jasmine.createSpy('sendOnExit') },
      encoder,
      false
    )

    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 10
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)
    segmentCollection.addRecord({
      type: RecordType.FullSnapshot,
      timestamp: 20
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED)

    expect(
      segmentCollection.getBaselineGenerationStateCountForDebug()
    ).toBe(2)

    encoder.resolve(1)
    expect(
      segmentCollection.getBaselineGenerationStateCountForDebug()
    ).toBe(2)

    encoder.resolve(0, {
      rawBytesCount: 100,
      output: new Uint8Array(),
      outputBytesCount: 0,
      error: new Error('stale baseline failed')
    })

    expect(
      segmentCollection.getBaselineGenerationStateCountForDebug()
    ).toBe(1)
    expect(send).toHaveBeenCalledTimes(1)
  })
})
