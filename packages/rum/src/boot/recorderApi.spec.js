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
    const startRecordingImpl = jasmine
      .createSpy('startRecordingImpl')
      .and.returnValue({
        stop: stopRecording,
        takeSubsequentFullSnapshot
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
        takeSubsequentFullSnapshot: jasmine.createSpy('takeSubsequentFullSnapshot')
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
})
