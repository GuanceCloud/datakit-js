import {
  BridgeCapability,
  LifeCycle,
  LifeCycleEventType,
  Observable,
  PageExitReason
} from '@cloudcare/browser-core'
import {
  makeRecorderApi
} from './recorderApi'
import {
  getDeflateWorkerStatus,
  resetDeflateWorkerState,
  DeflateWorkerStatus
} from '../domain/deflate'

describe('recorderApi', () => {
  let originalBridge

  class FakeWorker extends EventTarget {
    constructor() {
      super()
      this.postMessage = jasmine.createSpy('postMessage')
    }
  }

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
    resetDeflateWorkerState()
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
    resetDeflateWorkerState()
  })

  it('should return a no-op api when the bridge exists without record capability', () => {
    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => JSON.stringify(['localhost']),
      getCapabilities: () => JSON.stringify([])
    }

    const recorderApi = makeRecorderApi(jasmine.createSpy('startRecordingImpl'))

    recorderApi.start()
    expect(recorderApi.isRecording()).toBeFalse()
    expect(recorderApi.getReplayStats('view-1')).toBeUndefined()
  })

  it('should start recording once rum starts and the deflate worker initializes', () => {
    const worker = new FakeWorker()
    const stopRecording = jasmine.createSpy('stopRecording')
    const takeSubsequentFullSnapshot = jasmine.createSpy(
      'takeSubsequentFullSnapshot'
    )
    const snapshotCanvas = jasmine.createSpy('snapshotCanvas')
    const getSerializedNodeIdForDebug = jasmine
      .createSpy('getSerializedNodeIdForDebug')
      .and.returnValue(42)
    const getLastAutoCanvasSnapshotResultForDebug = jasmine
      .createSpy('getLastAutoCanvasSnapshotResultForDebug')
      .and.returnValue({
        status: 'completed',
        selectedCanvasCount: 1
      })
    const getAutoCanvasSnapshotDebugHistoryForDebug = jasmine
      .createSpy('getAutoCanvasSnapshotDebugHistoryForDebug')
      .and.returnValue([{ status: 'completed', selectedCanvasCount: 1 }])
    const getLastCanvasMutationForDebug = jasmine
      .createSpy('getLastCanvasMutationForDebug')
      .and.returnValue({
        canvasId: 42,
        encodedBytesCount: 2048
      })
    const getCanvasMutationHistoryForDebug = jasmine
      .createSpy('getCanvasMutationHistoryForDebug')
      .and.returnValue([{ canvasId: 42, encodedBytesCount: 2048 }])
    const getLastDomMutationForDebug = jasmine
      .createSpy('getLastDomMutationForDebug')
      .and.returnValue({
        addsCount: 1,
        removesCount: 0,
        textsCount: 0,
        attributesCount: 0
      })
    const getDomMutationHistoryForDebug = jasmine
      .createSpy('getDomMutationHistoryForDebug')
      .and.returnValue([
        {
          addsCount: 1,
          removesCount: 0,
          textsCount: 0,
          attributesCount: 0
        }
      ])
    const getLastReplaySegmentFlushForDebug = jasmine
      .createSpy('getLastReplaySegmentFlushForDebug')
      .and.returnValue({
        creationReason: 'init',
        flushReason: 'segment_duration_limit',
        recordCountsByType: {
          canvas_mutation: 3
        }
      })
    const getReplaySegmentFlushHistoryForDebug = jasmine
      .createSpy('getReplaySegmentFlushHistoryForDebug')
      .and.returnValue([
        {
          creationReason: 'init',
          flushReason: 'segment_duration_limit'
        },
        {
          creationReason: 'segment_bytes_limit',
          flushReason: 'segment_bytes_limit'
        }
      ])
    const getReplayPerformanceForDebug = jasmine
      .createSpy('getReplayPerformanceForDebug')
      .and.returnValue({
        processMutationsCount: 12,
        mutationCallbackCount: 4,
        replaySegmentFlushCount: 2
      })
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: stopRecording,
        takeSubsequentFullSnapshot,
        snapshotCanvas,
        getSerializedNodeIdForDebug,
        getLastAutoCanvasSnapshotResultForDebug,
        getAutoCanvasSnapshotDebugHistoryForDebug,
        getLastCanvasMutationForDebug,
        getCanvasMutationHistoryForDebug,
        getLastDomMutationForDebug,
        getDomMutationHistoryForDebug,
        getLastReplaySegmentFlushForDebug,
        getReplaySegmentFlushHistoryForDebug,
        getReplayPerformanceForDebug
      })

    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)
    const lifeCycle = new LifeCycle()

    recorderApi.start()
    recorderApi.onRumStart(
      lifeCycle,
      { workerUrl: '/worker.js' },
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )

    expect(startRecordingImpl).toHaveBeenCalled()
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Loading)
    expect(recorderApi.isRecording()).toBeFalse()

    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )

    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Initialized)
    expect(recorderApi.isRecording()).toBeTrue()

    recorderApi.takeSubsequentFullSnapshot()
    expect(takeSubsequentFullSnapshot).toHaveBeenCalled()

    const canvas = document.createElement('canvas')
    const snapshotResult = recorderApi.snapshotCanvas(canvas)
    expect(snapshotCanvas).toHaveBeenCalledWith(canvas, undefined)
    expect(snapshotResult).toBe(snapshotCanvas.calls.mostRecent().returnValue)
    expect(recorderApi.getSerializedNodeIdForDebug(canvas)).toBe(42)
    expect(getSerializedNodeIdForDebug).toHaveBeenCalledWith(canvas)
    expect(recorderApi.getLastAutoCanvasSnapshotResultForDebug()).toEqual({
      status: 'completed',
      selectedCanvasCount: 1
    })
    expect(getLastAutoCanvasSnapshotResultForDebug).toHaveBeenCalled()
    expect(recorderApi.getAutoCanvasSnapshotDebugHistoryForDebug()).toEqual([
      { status: 'completed', selectedCanvasCount: 1 }
    ])
    expect(getAutoCanvasSnapshotDebugHistoryForDebug).toHaveBeenCalled()
    expect(recorderApi.getLastCanvasMutationForDebug()).toEqual({
      canvasId: 42,
      encodedBytesCount: 2048
    })
    expect(getLastCanvasMutationForDebug).toHaveBeenCalled()
    expect(recorderApi.getCanvasMutationHistoryForDebug()).toEqual([
      { canvasId: 42, encodedBytesCount: 2048 }
    ])
    expect(getCanvasMutationHistoryForDebug).toHaveBeenCalled()
    expect(recorderApi.getLastDomMutationForDebug()).toEqual({
      addsCount: 1,
      removesCount: 0,
      textsCount: 0,
      attributesCount: 0
    })
    expect(getLastDomMutationForDebug).toHaveBeenCalled()
    expect(recorderApi.getDomMutationHistoryForDebug()).toEqual([
      {
        addsCount: 1,
        removesCount: 0,
        textsCount: 0,
        attributesCount: 0
      }
    ])
    expect(getDomMutationHistoryForDebug).toHaveBeenCalled()
    expect(recorderApi.getLastReplaySegmentFlushForDebug()).toEqual({
      creationReason: 'init',
      flushReason: 'segment_duration_limit',
      recordCountsByType: {
        canvas_mutation: 3
      }
    })
    expect(getLastReplaySegmentFlushForDebug).toHaveBeenCalled()
    expect(recorderApi.getReplaySegmentFlushHistoryForDebug()).toEqual([
      {
        creationReason: 'init',
        flushReason: 'segment_duration_limit'
      },
      {
        creationReason: 'segment_bytes_limit',
        flushReason: 'segment_bytes_limit'
      }
    ])
    expect(getReplaySegmentFlushHistoryForDebug).toHaveBeenCalled()
    expect(recorderApi.getReplayPerformanceForDebug()).toEqual({
      processMutationsCount: 12,
      mutationCallbackCount: 4,
      replaySegmentFlushCount: 2
    })
    expect(getReplayPerformanceForDebug).toHaveBeenCalled()

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    expect(stopRecording).toHaveBeenCalled()
  })

  it('should go back to intent-to-start on session expiration and restart on renewal', () => {
    const worker = new FakeWorker()
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: jasmine.createSpy('stop'),
        takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot'),
        snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
        getSerializedNodeIdForDebug: jasmine
          .createSpy('getSerializedNodeIdForDebug'),
        getLastAutoCanvasSnapshotResultForDebug: jasmine
          .createSpy('getLastAutoCanvasSnapshotResultForDebug'),
        getAutoCanvasSnapshotDebugHistoryForDebug: jasmine
          .createSpy('getAutoCanvasSnapshotDebugHistoryForDebug'),
        getLastCanvasMutationForDebug: jasmine
          .createSpy('getLastCanvasMutationForDebug'),
        getCanvasMutationHistoryForDebug: jasmine
          .createSpy('getCanvasMutationHistoryForDebug'),
        getLastDomMutationForDebug: jasmine
          .createSpy('getLastDomMutationForDebug'),
        getDomMutationHistoryForDebug: jasmine
          .createSpy('getDomMutationHistoryForDebug'),
        getLastReplaySegmentFlushForDebug: jasmine
          .createSpy('getLastReplaySegmentFlushForDebug'),
        getReplaySegmentFlushHistoryForDebug: jasmine
          .createSpy('getReplaySegmentFlushHistoryForDebug'),
        getReplayPerformanceForDebug: jasmine
          .createSpy('getReplayPerformanceForDebug')
      })

    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)
    const lifeCycle = new LifeCycle()

    recorderApi.start()
    recorderApi.onRumStart(
      lifeCycle,
      { workerUrl: '/worker.js' },
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )

    expect(startRecordingImpl.calls.count()).toBe(1)

    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)
    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)

    expect(startRecordingImpl.calls.count()).toBe(2)
  })

  it('should preserve force before rum starts and force the session before recording', () => {
    const worker = new FakeWorker()
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: jasmine.createSpy('stop'),
        takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot')
      })
    const lifeCycle = new LifeCycle()
    let forced = false
    const sessionManager = {
      setForcedSession: jasmine
        .createSpy('setForcedSession')
        .and.callFake(function () {
          forced = true
          lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)
        }),
      findTrackedSession: function () {
        return forced
          ? {
              id: 'forced-session-id',
              sessionReplayAllowed: true
            }
          : undefined
      }
    }
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)

    recorderApi.start({ force: true })
    recorderApi.onRumStart(
      lifeCycle,
      { workerUrl: '/worker.js' },
      sessionManager,
      {},
      undefined
    )

    expect(sessionManager.setForcedSession).toHaveBeenCalledTimes(1)
    expect(startRecordingImpl).toHaveBeenCalledTimes(1)

    recorderApi.start({ force: true })

    expect(startRecordingImpl).toHaveBeenCalledTimes(1)
  })

  it('should start an intent-to-record when the current session becomes forced', () => {
    const worker = new FakeWorker()
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: jasmine.createSpy('stop'),
        takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot')
      })
    const sessionStateUpdateObservable = new Observable()
    let forced = false
    const sessionManager = {
      sessionStateUpdateObservable,
      findTrackedSession: function () {
        return forced
          ? {
              id: 'forced-session-id',
              sessionReplayAllowed: true
            }
          : undefined
      }
    }
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      sessionManager,
      {},
      undefined
    )

    recorderApi.start()
    forced = true
    sessionStateUpdateObservable.notify({
      previousState: { forcedSession: undefined },
      newState: { forcedSession: '1' }
    })

    expect(startRecordingImpl).toHaveBeenCalledTimes(1)
  })

  it('should keep snapshotCanvas as a no-op before the recorder starts', () => {
    const recorderApi = makeRecorderApi(jasmine.createSpy('startRecordingImpl'))

    expect(recorderApi.snapshotCanvas(document.createElement('canvas'))).toEqual(
      {
        ok: false,
        reason: 'not_recording'
      }
    )
    expect(
      recorderApi.getSerializedNodeIdForDebug(document.createElement('canvas'))
    ).toBeUndefined()
    expect(recorderApi.getLastAutoCanvasSnapshotResultForDebug()).toBeUndefined()
    expect(recorderApi.getAutoCanvasSnapshotDebugHistoryForDebug()).toBeUndefined()
    expect(recorderApi.getLastCanvasMutationForDebug()).toBeUndefined()
    expect(recorderApi.getCanvasMutationHistoryForDebug()).toBeUndefined()
    expect(recorderApi.getLastDomMutationForDebug()).toBeUndefined()
    expect(recorderApi.getDomMutationHistoryForDebug()).toBeUndefined()
    expect(recorderApi.getLastReplaySegmentFlushForDebug()).toBeUndefined()
    expect(recorderApi.getReplaySegmentFlushHistoryForDebug()).toBeUndefined()
    expect(recorderApi.getReplayPerformanceForDebug()).toBeUndefined()
  })
})
