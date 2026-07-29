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
  DeflateWorkerStatus,
  startDeflateWorker
} from '../domain/deflate'

describe('recorderApi', () => {
  let originalBridge

  class FakeWorker extends EventTarget {
    constructor() {
      super()
      this.postMessage = jasmine.createSpy('postMessage')
      this.terminate = jasmine.createSpy('terminate')
    }
  }

  class SnapshotDispatchWorker {
    constructor() {
      this.listeners = {}
      this.postMessage = jasmine.createSpy('postMessage')
      this.terminate = jasmine.createSpy('terminate')
    }

    addEventListener(type, listener) {
      if (!this.listeners[type]) {
        this.listeners[type] = []
      }
      this.listeners[type].push(listener)
    }

    removeEventListener(type, listener) {
      this.listeners[type] = (this.listeners[type] || []).filter(
        (candidate) => candidate !== listener
      )
    }

    dispatchEvent(event) {
      ;(this.listeners[event.type] || [])
        .slice()
        .forEach((listener) => listener(event))
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
    expect(recorderApi.isRecording()).toBeFalse()

    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )

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
    expect(stopRecording).toHaveBeenCalledWith(PageExitReason.UNLOADING)

    recorderApi.takeSubsequentFullSnapshot()
    expect(takeSubsequentFullSnapshot).toHaveBeenCalledTimes(1)
  })

  it('should not enter started state when recording stopped during initialization', () => {
    const worker = new FakeWorker()
    const stop = jasmine.createSpy('stop')
    const takeSubsequentFullSnapshot = jasmine.createSpy(
      'takeSubsequentFullSnapshot'
    )
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(function () {
        arguments[6]()
        return {
          stop,
          isStopped: () => true,
          takeSubsequentFullSnapshot
        }
      })
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )

    expect(startRecordingImpl).toHaveBeenCalledTimes(1)
    expect(recorderApi.isRecording()).toBeFalse()
    expect(stop).toHaveBeenCalledTimes(1)
    recorderApi.takeSubsequentFullSnapshot()
    expect(takeSubsequentFullSnapshot).not.toHaveBeenCalled()
  })

  it('should clear stopped recording state immediately and ignore a stale stop callback', async () => {
    const worker = new FakeWorker()
    const stoppedCallbacks = []
    const getReplayPerformanceForDebug = jasmine.createSpy(
      'getReplayPerformanceForDebug'
    )
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(function () {
        stoppedCallbacks.push(arguments[6])
        return {
          stop: jasmine.createSpy('stop'),
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          ),
          getReplayPerformanceForDebug
        }
      })
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )
    expect(recorderApi.isRecording()).toBeTrue()

    stoppedCallbacks[0]('full_snapshot_failure')

    // Verify the callback changed state without relying on isRecording() to
    // reconcile the stopped implementation first.
    expect(recorderApi.getReplayPerformanceForDebug()).toBeUndefined()
    expect(
      await recorderApi.snapshotCanvas(document.createElement('canvas'))
    ).toEqual({
      ok: false,
      reason: 'not_recording'
    })

    recorderApi.start()
    expect(startRecordingImpl).toHaveBeenCalledTimes(2)
    expect(recorderApi.isRecording()).toBeTrue()

    stoppedCallbacks[0]('late_old_recording_stop')
    expect(recorderApi.isRecording()).toBeTrue()
  })

  it('should restart after runtime replay reset exhaustion without requiring an explicit stop', () => {
    const worker = new FakeWorker()
    const recordingStates = []
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(() => {
        const recordingState = { stopped: false }
        recordingStates.push(recordingState)
        return {
          stop: jasmine.createSpy('stop'),
          isStopped: () => recordingState.stopped,
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          )
        }
      })
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )
    expect(recorderApi.isRecording()).toBeTrue()

    // startRecording also marks itself stopped after repeated baseline reset
    // failures. The next public start must reconcile that state first.
    recordingStates[0].stopped = true
    recorderApi.start()

    expect(startRecordingImpl).toHaveBeenCalledTimes(2)
    expect(recordingStates.length).toBe(2)
    expect(recorderApi.isRecording()).toBeTrue()
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

  it('should stop recording and recreate the worker after a terminal encoder error', () => {
    const worker = new FakeWorker()
    const removeEventListenerSpy = spyOn(
      EventTarget.prototype,
      'removeEventListener'
    ).and.callThrough()
    const stopRecording = jasmine.createSpy('stopRecording')
    const createDeflateWorkerImpl = jasmine
      .createSpy('createDeflateWorkerImpl')
      .and.returnValue(worker)
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(function () {
        return {
          stop: function () {
            stopRecording()
          },
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          )
        }
      })
    const recorderApi = makeRecorderApi(
      startRecordingImpl,
      createDeflateWorkerImpl
    )
    const lifeCycle = new LifeCycle()
    const sessionManager = {
      findTrackedSession: () => ({
        sessionReplayAllowed: true
      })
    }

    recorderApi.start()
    recorderApi.onRumStart(
      lifeCycle,
      { workerUrl: '/worker.js' },
      sessionManager,
      {},
      undefined
    )
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )

    expect(recorderApi.isRecording()).toBeTrue()

    worker.dispatchEvent(new Event('error'))

    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(recorderApi.isRecording()).toBeFalse()
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Nil)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(removeEventListenerSpy).toHaveBeenCalledTimes(4)

    recorderApi.start()

    expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(2)
    expect(startRecordingImpl).toHaveBeenCalledTimes(2)

    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.1' }
      })
    )

    expect(recorderApi.isRecording()).toBeTrue()
  })

  it('should recover when the recording implementation throws while starting', () => {
    const worker = new FakeWorker()
    const startupError = new Error('recording startup failed')
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(function () {
        if (startRecordingImpl.calls.count() === 1) {
          throw startupError
        }
        return {
          stop: jasmine.createSpy('stop'),
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          )
        }
      })
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)
    const sessionManager = {
      findTrackedSession: () => ({
        sessionReplayAllowed: true
      })
    }

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      sessionManager,
      {},
      undefined
    )

    expect(startRecordingImpl).toHaveBeenCalledTimes(1)
    expect(recorderApi.isRecording()).toBeFalse()

    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )
    recorderApi.start()

    expect(startRecordingImpl).toHaveBeenCalledTimes(2)
    expect(recorderApi.isRecording()).toBeTrue()
  })

  it('should retry with a new owned worker after an initialization error', () => {
    // Model an event source that already snapshotted both listeners before the
    // controller failure callback removes the encoder listener.
    const firstWorker = new SnapshotDispatchWorker()
    const secondWorker = new FakeWorker()
    const createDeflateWorkerImpl = jasmine
      .createSpy('createDeflateWorkerImpl')
      .and.returnValues(firstWorker, secondWorker)
    const stopRecording = jasmine.createSpy('stopRecording')
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: stopRecording,
        takeSubsequentFullSnapshot: jasmine.createSpy(
          'takeSubsequentFullSnapshot'
        )
      })
    const recorderApi = makeRecorderApi(
      startRecordingImpl,
      createDeflateWorkerImpl
    )
    const sessionManager = {
      findTrackedSession: () => ({
        sessionReplayAllowed: true
      })
    }

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      sessionManager,
      {},
      undefined
    )
    firstWorker.dispatchEvent(new Event('error'))

    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1)
    expect(recorderApi.isRecording()).toBeFalse()

    recorderApi.start()

    expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(2)
    expect(startRecordingImpl).toHaveBeenCalledTimes(2)
    secondWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.1' }
      })
    )
    expect(recorderApi.isRecording()).toBeTrue()
  })

  it('should not revive recording when the encoder fails while starting', () => {
    const worker = new FakeWorker()
    const terminalError = new Error('worker post failed')
    worker.postMessage.and.callFake(function (message) {
      if (message.action === 'write') {
        throw terminalError
      }
    })
    const stopRecording = jasmine.createSpy('stopRecording')
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(function (
        lifeCycle,
        configuration,
        sessionManager,
        viewContexts,
        deflateEncoder
      ) {
        deflateEncoder.write('first replay record')
        return {
          stop: function () {
            stopRecording()
            deflateEncoder.stop()
          },
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          )
        }
      })
    const recorderApi = makeRecorderApi(startRecordingImpl, () => worker)

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      { workerUrl: '/worker.js' },
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )

    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(recorderApi.isRecording()).toBeFalse()
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Nil)
  })

  it('should remain stopped when the final encoder write fails synchronously', () => {
    const worker = new FakeWorker()
    const terminalError = new Error('footer write failed')
    worker.postMessage.and.callFake(function (message) {
      if (message.action === 'write' && message.data === 'footer') {
        throw terminalError
      }
    })
    const stopRecording = jasmine.createSpy('stopRecording')
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.callFake(function (
        lifeCycle,
        configuration,
        sessionManager,
        viewContexts,
        deflateEncoder
      ) {
        return {
          stop: function (flushReason) {
            stopRecording(flushReason)
            deflateEncoder.write('footer')
          },
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          )
        }
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
    worker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })

    expect(stopRecording).toHaveBeenCalledOnceWith(PageExitReason.UNLOADING)
    expect(recorderApi.isRecording()).toBeFalse()
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Nil)
  })

  it('should fall back to an owned replay worker after a shared stream failure', () => {
    const sharedWorker = new FakeWorker()
    const fallbackWorker = new FakeWorker()
    startDeflateWorker(
      {},
      'RUM',
      jasmine.createSpy('rumFailure'),
      () => sharedWorker
    )
    sharedWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )
    const createDeflateWorkerImpl = jasmine
      .createSpy('createDeflateWorkerImpl')
      .and.returnValue(fallbackWorker)
    const stopRecording = jasmine.createSpy('stopRecording')
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: stopRecording,
        takeSubsequentFullSnapshot: jasmine.createSpy(
          'takeSubsequentFullSnapshot'
        )
      })
    const recorderApi = makeRecorderApi(
      startRecordingImpl,
      createDeflateWorkerImpl
    )
    const sessionManager = {
      findTrackedSession: () => ({
        sessionReplayAllowed: true
      })
    }

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      {},
      sessionManager,
      {},
      sharedWorker
    )

    expect(recorderApi.isRecording()).toBeTrue()
    expect(createDeflateWorkerImpl).not.toHaveBeenCalled()
    expect(startRecordingImpl.calls.mostRecent().args[4]).toEqual(
      jasmine.objectContaining({
        isAsync: true
      })
    )

    sharedWorker.dispatchEvent(new Event('error'))

    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(recorderApi.isRecording()).toBeFalse()
    expect(sharedWorker.terminate).not.toHaveBeenCalled()
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Initialized)

    recorderApi.start()

    expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(1)
    expect(startRecordingImpl).toHaveBeenCalledTimes(2)
    expect(recorderApi.isRecording()).toBeFalse()
    fallbackWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.1' }
      })
    )
    expect(recorderApi.isRecording()).toBeTrue()
    expect(sharedWorker.terminate).not.toHaveBeenCalled()
  })

  it('should stop a shared replay stream without terminating the RUM worker', () => {
    const sharedWorker = new FakeWorker()
    startDeflateWorker(
      {},
      'RUM',
      jasmine.createSpy('rumFailure'),
      () => sharedWorker
    )
    sharedWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )
    const createDeflateWorkerImpl = jasmine.createSpy(
      'createDeflateWorkerImpl'
    )
    const stopRecording = jasmine.createSpy('stopRecording')
    const recorderApi = makeRecorderApi(
      jasmine.createSpy('startRecordingImpl').and.returnValue({
        stop: stopRecording,
        takeSubsequentFullSnapshot: jasmine.createSpy(
          'takeSubsequentFullSnapshot'
        )
      }),
      createDeflateWorkerImpl
    )

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      {},
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      sharedWorker
    )
    expect(recorderApi.isRecording()).toBeTrue()

    recorderApi.stop()

    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(sharedWorker.terminate).not.toHaveBeenCalled()
    expect(createDeflateWorkerImpl).not.toHaveBeenCalled()
    expect(recorderApi.isRecording()).toBeFalse()
  })

  it('should preserve an owned worker on a normal stop and reuse it', () => {
    const ownedWorker = new FakeWorker()
    const createDeflateWorkerImpl = jasmine
      .createSpy('createDeflateWorkerImpl')
      .and.returnValue(ownedWorker)
    const stopRecording = jasmine.createSpy('stopRecording')
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: stopRecording,
        takeSubsequentFullSnapshot: jasmine.createSpy(
          'takeSubsequentFullSnapshot'
        )
      })
    const recorderApi = makeRecorderApi(
      startRecordingImpl,
      createDeflateWorkerImpl
    )

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      {},
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )
    ownedWorker.dispatchEvent(
      new MessageEvent('message', {
        data: { type: 'initialized', version: '1.0.0' }
      })
    )
    expect(recorderApi.isRecording()).toBeTrue()

    recorderApi.stop()
    recorderApi.start()

    expect(stopRecording).toHaveBeenCalledTimes(1)
    expect(ownedWorker.terminate).not.toHaveBeenCalled()
    expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(1)
    expect(startRecordingImpl).toHaveBeenCalledTimes(2)
    expect(recorderApi.isRecording()).toBeTrue()
  })

  it('should terminate an owned replay worker when initialization times out', () => {
    jasmine.clock().install()
    try {
      const replayWorker = new FakeWorker()
      const stopRecording = jasmine.createSpy('stopRecording')
      const startRecordingImpl = jasmine
        .createSpy('startRecordingImpl')
        .and.returnValue({
          stop: stopRecording,
          takeSubsequentFullSnapshot: jasmine.createSpy(
            'takeSubsequentFullSnapshot'
          )
        })
      const createDeflateWorkerImpl = jasmine
        .createSpy('createDeflateWorkerImpl')
        .and.returnValue(replayWorker)
      const recorderApi = makeRecorderApi(
        startRecordingImpl,
        createDeflateWorkerImpl
      )
      const sessionManager = {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      }

      recorderApi.start()
      recorderApi.onRumStart(
        new LifeCycle(),
        {},
        sessionManager,
        {},
        undefined
      )

      jasmine.clock().tick(10000)

      expect(stopRecording).toHaveBeenCalledTimes(1)
      expect(replayWorker.terminate).toHaveBeenCalledTimes(1)
      expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Nil)
      expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(1)
      expect(recorderApi.isRecording()).toBeFalse()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should reset owned worker state after a synchronous creation failure', () => {
    const createDeflateWorkerImpl = jasmine
      .createSpy('createDeflateWorkerImpl')
      .and.throwError('worker creation failed')
    const startRecordingImpl = jasmine.createSpy('startRecordingImpl')
    const recorderApi = makeRecorderApi(
      startRecordingImpl,
      createDeflateWorkerImpl
    )

    recorderApi.start()
    recorderApi.onRumStart(
      new LifeCycle(),
      {},
      {
        findTrackedSession: () => ({
          sessionReplayAllowed: true
        })
      },
      {},
      undefined
    )

    expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(1)
    expect(startRecordingImpl).not.toHaveBeenCalled()
    expect(recorderApi.isRecording()).toBeFalse()

    recorderApi.start()

    expect(createDeflateWorkerImpl).toHaveBeenCalledTimes(2)
    expect(startRecordingImpl).not.toHaveBeenCalled()
  })

  it('should keep snapshotCanvas as an async no-op before the recorder starts', async () => {
    const recorderApi = makeRecorderApi(jasmine.createSpy('startRecordingImpl'))

    const snapshotPromise = recorderApi.snapshotCanvas(
      document.createElement('canvas')
    )
    expect(snapshotPromise).toEqual(jasmine.any(Promise))
    expect(await snapshotPromise).toEqual({
      ok: false,
      reason: 'not_recording'
    })
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
