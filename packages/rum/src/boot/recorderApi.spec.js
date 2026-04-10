import {
  BridgeCapability,
  LifeCycle,
  LifeCycleEventType,
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
    expect(recorderApi.getLastReplaySegmentFlushForDebug()).toBeUndefined()
    expect(recorderApi.getReplaySegmentFlushHistoryForDebug()).toBeUndefined()
    expect(recorderApi.getReplayPerformanceForDebug()).toBeUndefined()
  })
})
