import {
  display,
  resetTelemetry,
  startFakeTelemetry
} from '@cloudcare/browser-core'
import {
  createDeflateWorker,
  createDeflateWorkerController,
  DeflateWorkerStatus,
  doStartDeflateWorker,
  getDeflateWorkerStatus,
  resetDeflateWorkerState,
  startDeflateWorker
} from './deflateWorker'

describe('deflateWorker', () => {
  function createWorker() {
    return {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener'),
      terminate: jasmine.createSpy('terminate')
    }
  }

  function emit(worker, type, event) {
    worker.listeners[type](event)
  }

  beforeEach(() => {
    jasmine.clock().install()
    resetDeflateWorkerState()
  })

  afterEach(() => {
    resetDeflateWorkerState()
    resetTelemetry()
    jasmine.clock().uninstall()
  })

  it('should start and initialize the worker once', () => {
    const worker = createWorker()

    const returnedWorker = startDeflateWorker(
      {},
      'rum',
      jasmine.createSpy('onInitializationFailure'),
      () => worker
    )

    expect(returnedWorker).toBe(worker)
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Loading)
    expect(worker.postMessage).toHaveBeenCalledWith({ action: 'init' })

    emit(worker, 'message', { data: { type: 'initialized', version: '1.2.3' } })

    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Initialized)
  })

  it('should revoke the inline worker object URL after initialization', () => {
    const worker = createWorker()
    const createObjectUrlSpy = spyOn(URL, 'createObjectURL').and.returnValue(
      'blob:session-replay-worker'
    )
    const revokeObjectUrlSpy = spyOn(URL, 'revokeObjectURL')
    const workerConstructorSpy = spyOn(window, 'Worker').and.returnValue(worker)
    const controller = createDeflateWorkerController()

    const inlineWorker = createDeflateWorker({})
    controller.start(
      {},
      'Session Replay',
      jasmine.createSpy('onInitializationFailure'),
      () => inlineWorker
    )
    emit(inlineWorker, 'message', {
      data: { type: 'initialized', version: '1.2.3' }
    })
    controller.reset()

    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1)
    expect(workerConstructorSpy).toHaveBeenCalledWith(
      'blob:session-replay-worker'
    )
    expect(revokeObjectUrlSpy).toHaveBeenCalledOnceWith(
      'blob:session-replay-worker'
    )
  })

  it('should revoke the inline worker object URL when construction fails', () => {
    spyOn(URL, 'createObjectURL').and.returnValue(
      'blob:failed-session-replay-worker'
    )
    const revokeObjectUrlSpy = spyOn(URL, 'revokeObjectURL')
    spyOn(window, 'Worker').and.throwError('worker construction failed')

    expect(() => createDeflateWorker({})).toThrowError(
      'worker construction failed'
    )
    expect(revokeObjectUrlSpy).toHaveBeenCalledOnceWith(
      'blob:failed-session-replay-worker'
    )
  })

  it('should keep independent worker controllers isolated', () => {
    const sharedWorker = createWorker()
    const isolatedWorker = createWorker()
    const isolatedController = createDeflateWorkerController()

    startDeflateWorker(
      {},
      'RUM',
      jasmine.createSpy('rumInitializationFailure'),
      () => sharedWorker
    )
    isolatedController.start(
      {},
      'Session Replay',
      jasmine.createSpy('replayInitializationFailure'),
      () => isolatedWorker
    )
    emit(sharedWorker, 'message', {
      data: { type: 'initialized', version: '1.2.3' }
    })
    emit(isolatedWorker, 'message', {
      data: { type: 'initialized', version: '1.2.3' }
    })

    isolatedController.reset()

    expect(isolatedWorker.terminate).toHaveBeenCalledTimes(1)
    expect(sharedWorker.terminate).not.toHaveBeenCalled()
    expect(isolatedController.getStatus()).toBe(DeflateWorkerStatus.Nil)
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Initialized)
  })

  it('should report initialization errors and move to error state', () => {
    const worker = createWorker()
    const displayErrorSpy = spyOn(display, 'error')
    const onInitializationFailure = jasmine.createSpy('onInitializationFailure')

    doStartDeflateWorker({}, 'rum', () => worker)
    emit(worker, 'error', new Event('error'))

    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Error)
    expect(displayErrorSpy).toHaveBeenCalled()
    expect(onInitializationFailure).not.toHaveBeenCalled()
  })

  it('should invoke initialization failure callbacks on timeout', () => {
    const worker = createWorker()
    const onInitializationFailure = jasmine.createSpy('onInitializationFailure')
    spyOn(display, 'error')

    startDeflateWorker({}, 'rum', onInitializationFailure, () => worker)
    jasmine.clock().tick(10000)

    expect(onInitializationFailure).toHaveBeenCalled()
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Error)
    expect(worker.removeEventListener).toHaveBeenCalledTimes(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
  })

  it('should notify initialization callbacks and release listeners on a worker error', () => {
    const worker = createWorker()
    const onInitializationFailure = jasmine.createSpy('onInitializationFailure')
    spyOn(display, 'error')

    startDeflateWorker({}, 'rum', onInitializationFailure, () => worker)
    emit(worker, 'error', new Event('error'))

    expect(onInitializationFailure).toHaveBeenCalled()
    expect(worker.removeEventListener).toHaveBeenCalledTimes(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Error)
  })

  it('should clean up and notify when the initialization post throws synchronously', () => {
    const worker = createWorker()
    const initializationError = new Error('init post failed')
    const onInitializationFailure = jasmine.createSpy(
      'onInitializationFailure'
    )
    worker.postMessage.and.throwError(initializationError)
    spyOn(display, 'error')

    const returnedWorker = startDeflateWorker(
      {},
      'rum',
      onInitializationFailure,
      () => worker
    )

    expect(returnedWorker).toBeUndefined()
    expect(onInitializationFailure).toHaveBeenCalledTimes(1)
    expect(worker.removeEventListener).toHaveBeenCalledTimes(2)
    expect(worker.terminate).toHaveBeenCalledTimes(1)
    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Error)
  })

  it('should report a runtime stream error with the matching stream id', () => {
    const worker = createWorker()
    const telemetryEvents = startFakeTelemetry()
    const runtimeError = new Error('deflate runtime failed')

    startDeflateWorker(
      {},
      'Session Replay',
      jasmine.createSpy('onInitializationFailure'),
      () => worker
    )
    emit(worker, 'message', { data: { type: 'initialized', version: '1.2.3' } })
    emit(worker, 'message', {
      data: {
        type: 'errored',
        error: runtimeError,
        streamId: 1
      }
    })

    expect(getDeflateWorkerStatus()).toBe(DeflateWorkerStatus.Initialized)
    expect(telemetryEvents).toEqual([
      jasmine.objectContaining({
        message: 'deflate runtime failed',
        stream_id: 1,
        worker_version: '1.2.3'
      })
    ])
  })
})
