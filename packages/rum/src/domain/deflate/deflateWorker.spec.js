import { display } from '@cloudcare/browser-core'
import {
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
      removeEventListener: jasmine.createSpy('removeEventListener')
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
  })
})
