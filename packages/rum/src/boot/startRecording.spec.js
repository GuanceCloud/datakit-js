import {
  LifeCycle,
  LifeCycleEventType,
  Observable,
  PageExitReason
} from '@cloudcare/browser-core'
import { startRecording } from './startRecording'
import { IncrementalSource, RecordType } from '../types'
import { setSerializedNodeId } from '../domain/replay/record/serializationUtils'
import { MAX_QUEUED_MUTATION_RECORDS } from '../domain/replay/record/mutationBatch'
import { SEGMENT_DURATION_LIMIT } from '../domain/replay/segmentCollection/segmentCollection'
import {
  SESSION_REPLAY_TIME_ANCHOR_INTERVAL,
  SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
  SESSION_REPLAY_TIME_ANCHOR_TAG
} from '../domain/replay/record/record'

describe('startRecording', () => {
  let originalBridge

  function createEncoder() {
    const encoder = {
      empty: true,
      isAsync: false,
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
          rawBytesCount: 100,
          output: new Uint8Array([1, 2, 3]),
          outputBytesCount: 3
        })
      })
    }
    return encoder
  }

  function createRecordApi() {
    return {
      stop: jasmine.createSpy('recordStop'),
      $rEmitTimeAnchor: jasmine.createSpy('emitTimeAnchor'),
      $rFlushCanvasCommands: jasmine.createSpy('flushCanvasCommands'),
      takeSubsequentFullSnapshot: jasmine.createSpy(
        'takeSubsequentFullSnapshot'
      ),
      flushMutations: jasmine.createSpy('flushMutations'),
      prepareForViewChange: jasmine.createSpy('prepareForViewChange')
    }
  }

  function parseBridgePayloads(sendEvent) {
    return sendEvent.calls.allArgs().map((args) => JSON.parse(args[0]))
  }

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
    // Initial snapshots use a hard production budget, so stale fixtures from
    // other randomized suites must not become part of these test baselines.
    document.body.textContent = ''
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should send replay records through the event bridge and react to view lifecycle events', (done) => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      }
    )

    const initialPayloads = parseBridgePayloads(sendEvent)
    expect(initialPayloads.some((payload) => payload.data.type === RecordType.Meta)).toBeTrue()
    expect(initialPayloads.some((payload) => payload.data.type === RecordType.FullSnapshot)).toBeTrue()

    sendEvent.calls.reset()

    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)

    let payloads = parseBridgePayloads(sendEvent)
    expect(payloads[payloads.length - 1]).toEqual({
      name: 'session_replay',
      data: jasmine.objectContaining({
        type: RecordType.ViewEnd
      }),
      view: { id: 'view-current' }
    })

    sendEvent.calls.reset()

    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 1234 }
    })

    setTimeout(() => {
      payloads = parseBridgePayloads(sendEvent)
      expect(
        payloads.some(
          (payload) =>
            payload.name === 'session_replay' &&
            payload.data.type === RecordType.FullSnapshot &&
            payload.data.timestamp === 1234
        )
      ).toBeTrue()

      recording.stop()
      done()
    }, 0)
  })

  it('should stop forwarding lifecycle-triggered replay records after stop is called', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()
    const onStopped = jasmine.createSpy('onStopped')

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      },
      undefined,
      undefined,
      onStopped
    )

    sendEvent.calls.reset()
    recording.stop('manual_stop')
    recording.stop('duplicate_stop')

    const stopPayloads = parseBridgePayloads(sendEvent)
    expect(stopPayloads).toEqual([
      jasmine.objectContaining({
        name: 'session_replay',
        data: jasmine.objectContaining({
          type: SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
          data: {
            tag: SESSION_REPLAY_TIME_ANCHOR_TAG,
            payload: {}
          }
        })
      })
    ])
    sendEvent.calls.reset()

    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 4567 }
    })

    expect(sendEvent).not.toHaveBeenCalled()
    expect(onStopped).toHaveBeenCalledOnceWith('manual_stop')
  })

  it('should keep records suppressed while the initial full snapshot continues asynchronously', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()
    const onStopped = jasmine.createSpy('onStopped')
    let now = 0
    spyOn(performance, 'now').and.callFake(() => {
      now += 40
      return now
    })

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      },
      undefined,
      undefined,
      onStopped
    )

    expect(recording.isStopped()).toBeFalse()
    expect(onStopped).not.toHaveBeenCalled()
    expect(
      parseBridgePayloads(sendEvent).some(
        (payload) =>
          payload.data.type === RecordType.FullSnapshot ||
          payload.data.type === RecordType.IncrementalSnapshot
      )
    ).toBeFalse()

    sendEvent.calls.reset()
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 4567 }
    })
    document.body.dispatchEvent(new Event('input', { bubbles: true }))

    expect(sendEvent).not.toHaveBeenCalled()
    recording.stop('pending_initial_stop')
    expect(recording.isStopped()).toBeTrue()
    expect(onStopped).toHaveBeenCalledOnceWith('pending_initial_stop')
  })

  it('should replace a pending initial snapshot at the next view boundary', () => {
    jasmine.clock().install()
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()
    const onStopped = jasmine.createSpy('onStopped')
    let now = 0
    const performanceNow = spyOn(performance, 'now').and.callFake(() => {
      now += 40
      return now
    })

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      },
      undefined,
      undefined,
      onStopped
    )

    try {
      expect(
        parseBridgePayloads(sendEvent).some(
          (payload) => payload.data.type === RecordType.FullSnapshot
        )
      ).toBeFalse()

      lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)
      expect(recording.isStopped()).toBeFalse()
      expect(onStopped).not.toHaveBeenCalled()

      performanceNow.and.returnValue(0)
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: { timeStamp: 4568 }
      })
      jasmine.clock().tick(250)

      expect(
        parseBridgePayloads(sendEvent).some(
          (payload) =>
            payload.data.type === RecordType.FullSnapshot &&
            payload.data.timestamp === 4568
        )
      ).toBeTrue()
      expect(recording.isStopped()).toBeFalse()
    } finally {
      recording.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should supersede a pending view snapshot without stopping recording', () => {
    jasmine.clock().install()
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()
    const onStopped = jasmine.createSpy('onStopped')
    const performanceNow = spyOn(performance, 'now').and.returnValue(0)

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      },
      undefined,
      undefined,
      onStopped
    )

    try {
      sendEvent.calls.reset()
      let now = 0
      performanceNow.and.callFake(() => {
        now += 40
        return now
      })
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: { timeStamp: 5000 }
      })
      lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)

      expect(recording.isStopped()).toBeFalse()
      expect(onStopped).not.toHaveBeenCalled()

      performanceNow.and.returnValue(0)
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: { timeStamp: 6000 }
      })
      jasmine.clock().tick(250)

      const payloads = parseBridgePayloads(sendEvent)
      const fullSnapshots = payloads.filter(
        (payload) => payload.data.type === RecordType.FullSnapshot
      )
      expect(
        fullSnapshots.some(
          (payload) => payload.data.timestamp === 5000
        )
      ).toBeFalse()
      expect(
        fullSnapshots.some(
          (payload) => payload.data.timestamp === 6000
        )
      ).toBeTrue()
      const viewEndIndex = payloads.findIndex(
        (payload) => payload.data.type === RecordType.ViewEnd
      )
      const nextFullSnapshotIndex = payloads.findIndex(
        (payload) =>
          payload.data.type === RecordType.FullSnapshot &&
          payload.data.timestamp === 6000
      )
      expect(viewEndIndex).toBeGreaterThanOrEqual(0)
      expect(nextFullSnapshotIndex).toBeGreaterThan(viewEndIndex)
      expect(recording.isStopped()).toBeFalse()
    } finally {
      recording.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should expose snapshotCanvas from the underlying recorder', async () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()
    const canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
    document.body.appendChild(canvas)

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]',
      sendEvent
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input',
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 40000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {},
      {
        findView: () => ({ id: 'view-current' })
      }
    )

    setSerializedNodeId(canvas, 42)
    const result = await recording.snapshotCanvas(canvas)
    const serializedNodeId = recording.getSerializedNodeIdForDebug(canvas)
    const autoSnapshotResult =
      recording.getLastAutoCanvasSnapshotResultForDebug()
    const replaySegmentFlushHistory =
      recording.getReplaySegmentFlushHistoryForDebug()
    const replayPerformance = recording.getReplayPerformanceForDebug()
    const lastDomMutation = recording.getLastDomMutationForDebug()

    expect(result).toEqual({ ok: true })
    expect(serializedNodeId).toBe(42)
    expect(autoSnapshotResult).toBeUndefined()
    expect(replaySegmentFlushHistory).toEqual([])
    expect(lastDomMutation).toBeUndefined()
    expect(replayPerformance).toEqual(
      jasmine.objectContaining({
        processMutationsCount: jasmine.any(Number),
        mutationCallbackCount: jasmine.any(Number),
        replaySegmentFlushCount: 0
      })
    )
    expect(
      parseBridgePayloads(sendEvent).some(
        (payload) =>
          payload.name === 'session_replay' &&
          payload.data.type === RecordType.IncrementalSnapshot &&
          payload.data.data.source === 9
      )
    ).toBeTrue()

    recording.stop()
    canvas.remove()
  })

  it('should expose monotonic sequence numbers in replay segment flush debug history', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const httpRequest = {
      send: jasmine.createSpy('send'),
      sendOnExit: jasmine.createSpy('sendOnExit')
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      httpRequest
    )

    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 1000 }
    })
    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
      startClocks: { timeStamp: 2000 }
    })

    const flushHistory = recording.getReplaySegmentFlushHistoryForDebug()

    expect(flushHistory.length).toBeGreaterThan(0)
    flushHistory.forEach((entry, index) => {
      expect(entry.sequence).toBe(index + 1)
    })

    recording.stop()
  })

  it('should expose flushReplayMutationsForDebug from the underlying recorder', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const httpRequest = {
      send: jasmine.createSpy('send'),
      sendOnExit: jasmine.createSpy('sendOnExit')
    }

    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      httpRequest
    )

    expect(function () {
      recording.flushReplayMutationsForDebug()
    }).not.toThrow()

    recording.stop()
  })

  it('should flush pending DOM mutations before stopping the segment', (done) => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const httpRequest = {
      send: jasmine.createSpy('send'),
      sendOnExit: jasmine.createSpy('sendOnExit')
    }
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      httpRequest
    )
    const addedNode = document.createElement('div')

    encoder.write.calls.reset()
    document.body.appendChild(addedNode)

    setTimeout(() => {
      recording.stop()

      expect(
        encoder.write.calls
          .allArgs()
          .some(
            (args) =>
              typeof args[0] === 'string' &&
              args[0].indexOf('"source":0') !== -1
          )
      ).toBeTrue()

      addedNode.remove()
      done()
    }, 0)
  })

  it('should admit final Canvas commands before stopping the segment', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const recordApi = createRecordApi()
    let recordOptions
    const canvasRecord = {
      type: RecordType.IncrementalSnapshot,
      timestamp: 1,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 1,
        type: '2D',
        commands: [{ property: 'fillRect', args: [1, 2, 3, 4] }]
      }
    }
    recordApi.$rFlushCanvasCommands.and.callFake(() => {
      expect(recordOptions.emit(canvasRecord)).toBeTrue()
    })
    const recordImpl = jasmine
      .createSpy('record')
      .and.callFake((options) => {
        recordOptions = options
        return recordApi
      })
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      undefined,
      undefined,
      recordImpl
    )

    recording.stop('manual_stop')

    expect(recordApi.$rFlushCanvasCommands).toHaveBeenCalledTimes(1)
    expect(recordApi.$rEmitTimeAnchor).toHaveBeenCalledTimes(1)
    expect(encoder.finish).toHaveBeenCalledTimes(1)
    expect(recordApi.stop).toHaveBeenCalledOnceWith('manual_stop', true)
    expect(
      recordApi.$rFlushCanvasCommands.calls.first().invocationOrder
    ).toBeLessThan(encoder.finish.calls.first().invocationOrder)
    expect(
      recordApi.$rEmitTimeAnchor.calls.first().invocationOrder
    ).toBeLessThan(encoder.finish.calls.first().invocationOrder)
    expect(encoder.finish.calls.first().invocationOrder).toBeLessThan(
      recordApi.stop.calls.first().invocationOrder
    )
  })

  it('should admit the final time anchor without draining the normal-stop encoder backlog', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    encoder.getPendingEncodedBytesCount = () => 0
    encoder.estimateEncodedBytesCount = () => 1
    encoder.flushPendingActionsSync = jasmine.createSpy(
      'flushPendingActionsSync'
    )
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      }
    )
    encoder.write.calls.reset()
    pendingRawBytesCount = 4 * 1024 * 1024

    recording.stop('manual_stop')

    expect(encoder.flushPendingActionsSync).not.toHaveBeenCalled()
    expect(
      encoder.write.calls
        .allArgs()
        .some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].indexOf(SESSION_REPLAY_TIME_ANCHOR_TAG) !== -1
        )
    ).toBeTrue()
  })

  it('should flush Canvas commands before retiring the old view', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const recordApi = createRecordApi()
    const recordImpl = jasmine
      .createSpy('record')
      .and.returnValue(recordApi)
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      undefined,
      undefined,
      recordImpl
    )

    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)

    expect(recordApi.$rFlushCanvasCommands).toHaveBeenCalledTimes(1)
    expect(recordApi.prepareForViewChange).toHaveBeenCalledTimes(1)
    expect(
      recordApi.$rFlushCanvasCommands.calls.first().invocationOrder
    ).toBeLessThan(
      recordApi.prepareForViewChange.calls.first().invocationOrder
    )

    recording.stop()
  })

  it('should flush same-task DOM mutations before ending a view', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      }
    )
    const addedNode = document.createElement('div')

    encoder.write.calls.reset()
    document.body.appendChild(addedNode)
    lifeCycle.notify(LifeCycleEventType.VIEW_ENDED)

    const writes = encoder.write.calls
      .allArgs()
      .map((args) => args[0])
      .filter((data) => typeof data === 'string')
    const mutationIndex = writes.findIndex(
      (data) => data.indexOf('"source":0') !== -1
    )
    const viewEndIndex = writes.findIndex(
      (data) => data.indexOf('"type":' + RecordType.ViewEnd) !== -1
    )

    expect(mutationIndex).toBeGreaterThanOrEqual(0)
    expect(viewEndIndex).toBeGreaterThan(mutationIndex)

    recording.stop()
    addedNode.remove()
  })

  it('should recover DOM publication after synchronous structural admission rejection', () => {
    jasmine.clock().install()
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    const onStopped = jasmine.createSpy('onStopped')
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      onStopped
    )

    const rejectedChild = document.createElement('div')
    let acceptedSibling
    try {
      pendingRawBytesCount = 4 * 1024 * 1024
      document.body.appendChild(rejectedChild)
      recording.flushReplayMutationsForDebug()

      expect(
        recording.getSerializedNodeIdForDebug(rejectedChild)
      ).toBeUndefined()
      expect(recording.isStopped()).toBeFalse()
      expect(onStopped).not.toHaveBeenCalled()

      pendingRawBytesCount = 0
      jasmine.clock().tick(32)
      expect(
        recording.getSerializedNodeIdForDebug(rejectedChild)
      ).toEqual(jasmine.any(Number))
      const writesBeforeRecovery = encoder.write.calls.count()
      acceptedSibling = document.createElement('div')
      document.body.appendChild(acceptedSibling)
      recording.flushReplayMutationsForDebug()

      expect(
        recording.getSerializedNodeIdForDebug(acceptedSibling)
      ).toEqual(jasmine.any(Number))
      expect(encoder.write.calls.count()).toBeGreaterThan(writesBeforeRecovery)
    } finally {
      recording.stop()
      rejectedChild.remove()
      if (acceptedSibling) {
        acceptedSibling.remove()
      }
      jasmine.clock().uninstall()
    }
  })

  ;[
    PageExitReason.HIDDEN,
    PageExitReason.FROZEN,
    PageExitReason.PAGEHIDE
  ].forEach((pageExitReason) => {
    it(
      'should preserve a pending DOM recovery snapshot while the page is resumable: ' +
        pageExitReason,
      () => {
        jasmine.clock().install()
        const recoveryRoot = document.createElement('div')
        const recoverySibling = document.createElement('div')
        document.body.appendChild(recoveryRoot)
        document.body.appendChild(recoverySibling)
        const lifeCycle = new LifeCycle()
        const encoder = createEncoder()
        const recording = startRecording(
          lifeCycle,
          {
            defaultPrivacyLevel: 'mask-user-input'
          },
          {
            findTrackedSession: () => ({
              id: 'session-1',
              sessionReplayAllowed: true
            })
          },
          {
            findView: () => ({ id: 'view-current' })
          },
          encoder,
          {
            send: jasmine.createSpy('send'),
            sendOnExit: jasmine.createSpy('sendOnExit')
          }
        )

        try {
          encoder.write.calls.reset()
          for (
            let index = 0;
            index < MAX_QUEUED_MUTATION_RECORDS + 1;
            index += 1
          ) {
            const target =
              index % 2 === 0 ? recoveryRoot : recoverySibling
            target.setAttribute(
              'data-overflow-' + Math.floor(index / 2),
              String(index)
            )
          }
          recording.flushReplayMutationsForDebug()

          lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
            reason: pageExitReason
          })
          jasmine.clock().tick(1)

          expect(
            encoder.write.calls
              .allArgs()
              .some(
                (args) =>
                  typeof args[0] === 'string' &&
                  args[0].indexOf(
                    '"type":' + RecordType.FullSnapshot
                  ) !== -1
              )
          ).toBeTrue()
        } finally {
          recording.stop()
          recoveryRoot.remove()
          recoverySibling.remove()
          jasmine.clock().uninstall()
        }
      }
    )
  })

  it('should use the page-exit transport when stopped during unload', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const httpRequest = {
      send: jasmine.createSpy('send'),
      sendOnExit: jasmine.createSpy('sendOnExit')
    }
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      httpRequest
    )

    // A large initialization snapshot can flush before stop when the full
    // suite runs with a different DOM/test order. This assertion only covers
    // the transport selected by stop itself.
    httpRequest.send.calls.reset()
    httpRequest.sendOnExit.calls.reset()
    recording.stop('before_unload')

    expect(httpRequest.sendOnExit).toHaveBeenCalledTimes(1)
    expect(httpRequest.send).not.toHaveBeenCalled()
  })

  it('should force the bounded mutation drain before the unload segment closes', () => {
    const lifeCycle = new LifeCycle()
    const recordApi = createRecordApi()
    recordApi.flushMutations.and.returnValue('pending')
    const recordImpl = jasmine
      .createSpy('record')
      .and.returnValue(recordApi)
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      createEncoder(),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      undefined,
      undefined,
      recordImpl
    )

    recording.stop(PageExitReason.UNLOADING)

    expect(recordApi.flushMutations).toHaveBeenCalledWith(true)
    expect(
      recordApi.flushMutations.calls.first().invocationOrder
    ).toBeLessThan(recordApi.stop.calls.first().invocationOrder)
    expect(recordApi.stop).toHaveBeenCalledOnceWith(
      PageExitReason.UNLOADING,
      true
    )
  })

  it('should expose manual full snapshots as best-effort without downgrading internal recovery', () => {
    const lifeCycle = new LifeCycle()
    const recordApi = createRecordApi()
    const recordImpl = jasmine
      .createSpy('record')
      .and.returnValue(recordApi)
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      createEncoder(),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      },
      undefined,
      undefined,
      recordImpl
    )

    recording.takeSubsequentFullSnapshot()

    expect(
      recordApi.takeSubsequentFullSnapshot
    ).toHaveBeenCalledOnceWith(undefined, true)
    recording.stop()
  })

  it('should retry the final mutation after unload releases encoder backpressure', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    let pendingRawBytesCount = 0
    encoder.getPendingRawBytesCount = () => pendingRawBytesCount
    encoder.getPendingEncodedBytesCount = () => 0
    encoder.estimateEncodedBytesCount = () => 1
    encoder.flushPendingActionsSync = jasmine
      .createSpy('flushPendingActionsSync')
      .and.callFake(() => {
        pendingRawBytesCount = 0
      })
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true
        })
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      }
    )
    encoder.write.calls.reset()

    const child = document.createElement('div')
    child.setAttribute('data-final-unload-mutation', 'captured')
    document.body.appendChild(child)
    pendingRawBytesCount = 4 * 1024 * 1024

    recording.stop(PageExitReason.UNLOADING)

    expect(encoder.flushPendingActionsSync).toHaveBeenCalled()
    expect(
      encoder.write.calls
        .allArgs()
        .some(
          (args) =>
            typeof args[0] === 'string' &&
            args[0].indexOf('data-final-unload-mutation') !== -1
        )
    ).toBeTrue()
  })

  it('should unsubscribe from error-session updates when stopping', () => {
    const unsubscribe = jasmine.createSpy('unsubscribe')
    const recording = startRecording(
      new LifeCycle(),
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true,
          errorSessionReplayAllowed: true,
          sessionHasError: false
        }),
        sessionStateUpdateObservable: {
          subscribe: () => ({ unsubscribe })
        }
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      createEncoder(),
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      }
    )

    recording.stop()

    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('should keep an idle error-only buffer compact and anchor it when the first error unlocks replay', () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(0))
    const sessionStateUpdateObservable = new Observable()
    const encoder = createEncoder()
    const send = jasmine.createSpy('send')
    let recording

    try {
      recording = startRecording(
        new LifeCycle(),
        {
          defaultPrivacyLevel: 'mask-user-input'
        },
        {
          findTrackedSession: () => ({
            id: 'session-1',
            sessionReplayAllowed: true,
            errorSessionReplayAllowed: true,
            sessionHasError: false
          }),
          sessionStateUpdateObservable
        },
        {
          findView: () => ({ id: 'view-current' })
        },
        encoder,
        {
          send,
          sendOnExit: jasmine.createSpy('sendOnExit')
        }
      )

      jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
      expect(encoder.finish).toHaveBeenCalledTimes(1)
      const writesAfterInitialSegment = encoder.write.calls.count()

      jasmine.clock().tick(60 * 60 * 1000)
      expect(encoder.finish).toHaveBeenCalledTimes(1)
      expect(encoder.write.calls.count()).toBe(writesAfterInitialSegment)
      expect(send).not.toHaveBeenCalled()

      sessionStateUpdateObservable.notify({
        previousState: { hasError: false },
        newState: { hasError: true }
      })

      expect(send).toHaveBeenCalledTimes(1)
      expect(
        encoder.write.calls
          .allArgs()
          .some(
            (args) =>
              typeof args[0] === 'string' &&
              args[0].indexOf(SESSION_REPLAY_TIME_ANCHOR_TAG) !== -1
          )
      ).toBeTrue()

      jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
      expect(encoder.finish).toHaveBeenCalledTimes(2)
      expect(send).toHaveBeenCalledTimes(2)
    } finally {
      if (recording) {
        recording.stop()
      }
      jasmine.clock().uninstall()
    }
  })

  it('should roll back initialized resources when startup throws midway', () => {
    const lifeCycle = new LifeCycle()
    const originalSubscribe = lifeCycle.subscribe.bind(lifeCycle)
    const startupError = new Error('view subscription failed')
    const trackedUnsubscribes = []
    let subscribeCount = 0
    spyOn(lifeCycle, 'subscribe').and.callFake(function (eventType, callback) {
      subscribeCount += 1
      if (subscribeCount === 5) {
        throw startupError
      }
      const subscription = originalSubscribe(eventType, callback)
      const unsubscribe = jasmine
        .createSpy('unsubscribe')
        .and.callFake(subscription.unsubscribe)
      trackedUnsubscribes.push(unsubscribe)
      return { unsubscribe }
    })
    const disconnectSpy = spyOn(
      MutationObserver.prototype,
      'disconnect'
    ).and.callThrough()
    const onStopped = jasmine.createSpy('onStopped')

    expect(() =>
      startRecording(
        lifeCycle,
        {
          defaultPrivacyLevel: 'mask-user-input'
        },
        {
          findTrackedSession: () => ({
            id: 'session-1',
            sessionReplayAllowed: true
          })
        },
        {
          findView: () => ({ id: 'view-current' })
        },
        createEncoder(),
        {
          send: jasmine.createSpy('send'),
          sendOnExit: jasmine.createSpy('sendOnExit')
        },
        onStopped
      )
    ).toThrow(startupError)

    expect(trackedUnsubscribes.length).toBe(4)
    trackedUnsubscribes.forEach((unsubscribe) => {
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })
    expect(disconnectSpy).toHaveBeenCalled()
    expect(onStopped).toHaveBeenCalledOnceWith('start_failure')
  })

  it('should clean up segment subscriptions when record initialization throws', () => {
    const lifeCycle = new LifeCycle()
    const originalSubscribe = lifeCycle.subscribe.bind(lifeCycle)
    const trackedUnsubscribes = []
    spyOn(lifeCycle, 'subscribe').and.callFake((eventType, callback) => {
      const subscription = originalSubscribe(eventType, callback)
      const unsubscribe = jasmine
        .createSpy('unsubscribe')
        .and.callFake(subscription.unsubscribe)
      trackedUnsubscribes.push(unsubscribe)
      return { unsubscribe }
    })
    const startupError = new Error('record initialization failed')
    const onStopped = jasmine.createSpy('onStopped')

    expect(() =>
      startRecording(
        lifeCycle,
        { defaultPrivacyLevel: 'mask-user-input' },
        {
          findTrackedSession: () => ({
            id: 'session-1',
            sessionReplayAllowed: true
          })
        },
        { findView: () => ({ id: 'view-current' }) },
        createEncoder(),
        {
          send: jasmine.createSpy('send'),
          sendOnExit: jasmine.createSpy('sendOnExit')
        },
        onStopped,
        undefined,
        () => {
          throw startupError
        }
      )
    ).toThrow(startupError)

    expect(trackedUnsubscribes).toHaveSize(2)
    trackedUnsubscribes.forEach((unsubscribe) => {
      expect(unsubscribe).toHaveBeenCalledTimes(1)
    })
    expect(onStopped).toHaveBeenCalledOnceWith('start_failure')
  })

  it('should reuse one replay request across recorder restarts', () => {
    const lifeCycle = new LifeCycle()
    const createHttpRequestImpl = jasmine
      .createSpy('createHttpRequest')
      .and.returnValue({
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      })
    const configuration = {
      defaultPrivacyLevel: 'mask-user-input',
      sessionReplayEndPoint: '/replay',
      retryMaxSize: 3
    }
    const sessionManager = {
      findTrackedSession: () => ({
        id: 'session-1',
        sessionReplayAllowed: true
      })
    }
    const viewContexts = {
      findView: () => ({ id: 'view-current' })
    }
    const recordImpl = jasmine
      .createSpy('record')
      .and.callFake(createRecordApi)

    const firstRecording = startRecording(
      lifeCycle,
      configuration,
      sessionManager,
      viewContexts,
      createEncoder(),
      undefined,
      undefined,
      createHttpRequestImpl,
      recordImpl
    )
    firstRecording.stop('session_expire')
    const secondRecording = startRecording(
      lifeCycle,
      configuration,
      sessionManager,
      viewContexts,
      createEncoder(),
      undefined,
      undefined,
      createHttpRequestImpl,
      recordImpl
    )
    secondRecording.stop('manual_stop')

    expect(createHttpRequestImpl).toHaveBeenCalledTimes(1)
    expect(recordImpl).toHaveBeenCalledTimes(2)
  })

  it('should finish every cleanup task when one cleanup throws', () => {
    const lifeCycle = new LifeCycle()
    const encoder = createEncoder()
    const unsubscribe = jasmine
      .createSpy('unsubscribe')
      .and.throwError('unsubscribe failed')
    const recording = startRecording(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask-user-input'
      },
      {
        findTrackedSession: () => ({
          id: 'session-1',
          sessionReplayAllowed: true,
          errorSessionReplayAllowed: true,
          sessionHasError: false
        }),
        sessionStateUpdateObservable: {
          subscribe: () => ({ unsubscribe })
        }
      },
      {
        findView: () => ({ id: 'view-current' })
      },
      encoder,
      {
        send: jasmine.createSpy('send'),
        sendOnExit: jasmine.createSpy('sendOnExit')
      }
    )

    expect(() => recording.stop()).not.toThrow()
    expect(unsubscribe).toHaveBeenCalledTimes(1)

    const finishCountAfterStop = encoder.finish.calls.count()
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: 'hidden'
    })

    expect(encoder.finish.calls.count()).toBe(finishCountAfterStop)
  })

  it('should tear down recording after repeated full snapshot failures', () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date(0))
    try {
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
      const recording = startRecording(
        lifeCycle,
        {
          defaultPrivacyLevel: 'mask-user-input'
        },
        {
          findTrackedSession: () => ({
            id: 'session-1',
            sessionReplayAllowed: true
          })
        },
        {
          findView: () => ({ id: 'view-current' })
        },
        encoder,
        {
          send: jasmine.createSpy('send'),
          sendOnExit: jasmine.createSpy('sendOnExit')
        }
      )

      for (let failure = 0; failure < 3; failure += 1) {
        jasmine.clock().tick(SEGMENT_DURATION_LIMIT)
        jasmine.clock().tick(0)
      }

      const fullSnapshotCount =
        recording.getReplayPerformanceForDebug().fullSnapshotCount
      lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
        startClocks: { timeStamp: 20000 }
      })
      jasmine.clock().tick(0)

      expect(
        recording.getReplayPerformanceForDebug().fullSnapshotCount
      ).toBe(fullSnapshotCount)
      recording.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })
})
