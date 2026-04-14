import {
  CanvasEncodeWorkerStatus,
  CANVAS_WORKER_INITIALIZATION_TIME_OUT_DELAY,
  createCanvasEncodeWorkerManager
} from './canvasEncodeWorker'

describe('replay/record/canvasEncodeWorker', () => {
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
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should initialize the worker once', () => {
    var worker = createWorker()
    var manager = createCanvasEncodeWorkerManager(
      {},
      {
        createWorker: function () {
          return { worker: worker }
        },
        url: {
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        }
      }
    )

    expect(manager.ensureWorker()).toBe(worker)
    expect(manager.getStatus()).toBe(CanvasEncodeWorkerStatus.Loading)
    expect(worker.postMessage).toHaveBeenCalledWith({ action: 'init' })

    emit(worker, 'message', { data: { action: 'initialized', version: '1.0.0' } })

    expect(manager.getStatus()).toBe(CanvasEncodeWorkerStatus.Initialized)
  })

  it('should move to error state on initialization timeout', () => {
    var worker = createWorker()
    var displayErrorSpy = jasmine.createSpy('displayError')
    var onError = jasmine.createSpy('onError')
    var manager = createCanvasEncodeWorkerManager(
      {},
      {
        createWorker: function () {
          return { worker: worker }
        },
        url: {
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        displayError: displayErrorSpy,
        onError: onError
      }
    )

    manager.ensureWorker()
    jasmine.clock().tick(CANVAS_WORKER_INITIALIZATION_TIME_OUT_DELAY)

    expect(manager.getStatus()).toBe(CanvasEncodeWorkerStatus.Error)
    expect(displayErrorSpy).toHaveBeenCalled()
    expect(onError).toHaveBeenCalled()
  })

  it('should keep external worker urls intact on stop', () => {
    var worker = createWorker()
    var revokeObjectURL = jasmine.createSpy('revokeObjectURL')
    var manager = createCanvasEncodeWorkerManager(
      { replayCanvasWorkerUrl: '/canvas-worker.js' },
      {
        createWorker: function () {
          return {
            worker: worker,
            workerUrl: '/canvas-worker.js',
            usesExternalUrl: true
          }
        },
        url: {
          revokeObjectURL: revokeObjectURL
        }
      }
    )

    manager.ensureWorker()
    manager.stop()

    expect(revokeObjectURL).not.toHaveBeenCalled()
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('should revoke inline worker urls on stop without injected options.url', () => {
    var worker = createWorker()
    var revokeObjectURL = jasmine.createSpy('revokeObjectURL')
    var manager = createCanvasEncodeWorkerManager(
      {},
      {
        createWorker: function () {
          return {
            worker: worker,
            workerUrl: 'blob:canvas-worker',
            usesExternalUrl: false,
            urlObject: {
              revokeObjectURL: revokeObjectURL
            }
          }
        }
      }
    )

    manager.ensureWorker()
    manager.stop()

    expect(revokeObjectURL).toHaveBeenCalledWith('blob:canvas-worker')
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('should display a targeted message for external canvas worker startup failures', () => {
    var worker = createWorker()
    var displayErrorSpy = jasmine.createSpy('displayError')
    var manager = createCanvasEncodeWorkerManager(
      { replayCanvasWorkerUrl: '/canvas-worker.js' },
      {
        createWorker: function () {
          return {
            worker: worker,
            workerUrl: '/canvas-worker.js',
            usesExternalUrl: true
          }
        },
        url: {
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        displayError: displayErrorSpy
      }
    )

    manager.ensureWorker()
    emit(worker, 'error', new Event('error'))

    expect(manager.getStatus()).toBe(CanvasEncodeWorkerStatus.Error)
    expect(displayErrorSpy.calls.allArgs()).toContain([
      'Please make sure the Canvas Worker URL /canvas-worker.js is correct and CSP is correctly configured.'
    ])
  })

  it('should report initialized worker runtime errors to telemetry', () => {
    var worker = createWorker()
    var telemetrySpy = jasmine.createSpy('addTelemetryError')
    var displayErrorSpy = jasmine.createSpy('displayError')
    var manager = createCanvasEncodeWorkerManager(
      {},
      {
        createWorker: function () {
          return { worker: worker }
        },
        url: {
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        addTelemetryError: telemetrySpy,
        displayError: displayErrorSpy,
        onError: function () {},
        onInitialized: function () {},
        onMessage: function () {}
      }
    )

    manager.ensureWorker()
    emit(worker, 'message', {
      data: { action: 'initialized', version: '2.0.0' }
    })

    emit(worker, 'error', { error: new Error('runtime failed') })

    expect(manager.getStatus()).toBe(CanvasEncodeWorkerStatus.Initialized)
    expect(telemetrySpy).toHaveBeenCalledWith(jasmine.any(Error), {
      worker_version: '2.0.0'
    })
  })

  it('should ignore an old initialization timeout after the worker is stopped and restarted', () => {
    var firstWorker = createWorker()
    var secondWorker = createWorker()
    var createWorkerSpy = jasmine
      .createSpy('createWorker')
      .and.callFake(function () {
        return createWorkerSpy.calls.count() === 1
          ? { worker: firstWorker }
          : { worker: secondWorker }
      })
    var displayErrorSpy = jasmine.createSpy('displayError')
    var manager = createCanvasEncodeWorkerManager(
      {},
      {
        createWorker: createWorkerSpy,
        url: {
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        displayError: displayErrorSpy
      }
    )

    manager.ensureWorker()
    jasmine.clock().tick(1)
    manager.stop()
    manager.ensureWorker()
    emit(secondWorker, 'message', {
      data: { action: 'initialized', version: '2.0.0' }
    })
    jasmine.clock().tick(CANVAS_WORKER_INITIALIZATION_TIME_OUT_DELAY)

    expect(manager.getStatus()).toBe(CanvasEncodeWorkerStatus.Initialized)
    expect(displayErrorSpy).not.toHaveBeenCalledWith(
      'canvas encode worker failed to start: a timeout occurred while initializing the Worker'
    )
  })
})
