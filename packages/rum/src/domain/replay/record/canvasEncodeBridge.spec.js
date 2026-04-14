import {
  arrayBufferToBase64,
  createCanvasEncodeBridge
} from './canvasEncodeBridge'
import { CanvasEncodeWorkerStatus } from './canvasEncodeWorker'

describe('replay/record/canvasEncodeBridge', () => {
  let canvas

  function createTestWorker() {
    var listeners = {}
    return {
      worker: {
        addEventListener: jasmine.createSpy('addEventListener').and.callFake(
          function (type, handler) {
            listeners[type] = handler
          }
        ),
        removeEventListener: jasmine.createSpy('removeEventListener'),
        postMessage: jasmine.createSpy('postMessage'),
        terminate: jasmine.createSpy('terminate'),
        listeners: listeners
      },
      emitMessage: function (data) {
        listeners.message({ data: data })
      },
      emitError: function (error) {
        listeners.error({ error: error })
      }
    }
  }

  beforeEach(() => {
    canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
  })

  it('should fallback to main-thread encoding when worker encoding is unavailable', async () => {
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    const result = await bridge.encode(canvas)

    expect(result.width).toBe(20)
    expect(result.height).toBe(10)
    expect(result.dataUrl.startsWith('data:image/webp;base64,')).toBeTrue()
  })

  it('should preserve the actual main-thread data url mime type when toDataURL falls back', async () => {
    var originalToDataURL = canvas.toDataURL
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/png;base64,QUJD')

    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    const result = await bridge.encode(canvas)

    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,QUJD',
      width: 20,
      height: 10
    })

    canvas.toDataURL = originalToDataURL
  })

  it('should use worker encoding when supported', async () => {
    let messageHandler
    const worker = {
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        function (type, handler) {
          if (type === 'message') {
            messageHandler = handler
          }
        }
      ),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      postMessage: jasmine.createSpy('postMessage'),
      terminate: jasmine.createSpy('terminate')
    }
    const bitmap = { close: jasmine.createSpy('close') }
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve(bitmap)
        ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine.createSpy('createWorker').and.returnValue(worker)
      }
    )

    const resultPromise = bridge.encode(canvas)
    await Promise.resolve()

    expect(bridge.getWorkerStatus()).toBe(CanvasEncodeWorkerStatus.Loading)

    expect(worker.postMessage).toHaveBeenCalled()
    expect(worker.postMessage.calls.argsFor(0)[0]).toEqual({ action: 'init' })
    var request = worker.postMessage.calls.argsFor(1)[0]
    messageHandler({
      data: {
        action: 'initialized',
        version: 'test'
      }
    })
    messageHandler({
      data: {
        id: request.id,
        action: 'encoded',
        dataUrl: 'data:image/webp;base64,QUJD',
        width: 20,
        height: 10
      }
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })
    expect(bridge.getWorkerStatus()).toBe(CanvasEncodeWorkerStatus.Initialized)

    bridge.stop()
    expect(worker.terminate).toHaveBeenCalled()
  })

  it('should close the bitmap when worker encoding cannot start', async () => {
    const bitmap = { close: jasmine.createSpy('close') }
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve(bitmap)
        ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine.createSpy('createWorker').and.throwError(
          'init failed'
        )
      }
    )

    expect(await bridge.encode(canvas)).toEqual({
      dataUrl: jasmine.stringMatching(/^data:image\/webp;base64,/),
      width: 20,
      height: 10
    })
    expect(bitmap.close).toHaveBeenCalledTimes(1)
  })

  it('should prefer replayCanvasWorkerUrl over an inline canvas worker blob', async () => {
    let messageHandler
    const worker = {
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        function (type, handler) {
          if (type === 'message') {
            messageHandler = handler
          }
        }
      ),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      postMessage: jasmine.createSpy('postMessage'),
      terminate: jasmine.createSpy('terminate')
    }
    const createObjectURL = jasmine.createSpy('createObjectURL').and.returnValue('blob:test')
    const revokeObjectURL = jasmine.createSpy('revokeObjectURL')
    const WorkerSpy = jasmine.createSpy('Worker').and.returnValue(worker)
    const bitmap = { close: jasmine.createSpy('close') }
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasWorkerUrl: '/canvas-worker.js',
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve(bitmap)
        ),
        Worker: WorkerSpy,
        url: {
          createObjectURL: createObjectURL,
          revokeObjectURL: revokeObjectURL
        }
      }
    )

    const resultPromise = bridge.encode(canvas)
    await Promise.resolve()

    expect(WorkerSpy).toHaveBeenCalledWith('/canvas-worker.js')
    expect(createObjectURL).not.toHaveBeenCalled()
    expect(worker.postMessage.calls.argsFor(0)[0]).toEqual({ action: 'init' })

    var request = worker.postMessage.calls.argsFor(1)[0]
    messageHandler({
      data: {
        action: 'initialized',
        version: 'test'
      }
    })
    messageHandler({
      data: {
        id: request.id,
        action: 'encoded',
        dataUrl: 'data:image/webp;base64,QUJD',
        width: 20,
        height: 10
      }
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })

    bridge.stop()
    expect(revokeObjectURL).not.toHaveBeenCalled()
  })

  it('should preserve the actual worker data url mime type when worker encoding falls back', async () => {
    let messageHandler
    const worker = {
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        function (type, handler) {
          if (type === 'message') {
            messageHandler = handler
          }
        }
      ),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      postMessage: jasmine.createSpy('postMessage'),
      terminate: jasmine.createSpy('terminate')
    }
    const bitmap = { close: jasmine.createSpy('close') }
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve(bitmap)
        ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine.createSpy('createWorker').and.returnValue(worker)
      }
    )

    const resultPromise = bridge.encode(canvas)
    await Promise.resolve()

    var request = worker.postMessage.calls.argsFor(1)[0]
    messageHandler({
      data: {
        id: request.id,
        action: 'encoded',
        dataUrl: 'data:image/png;base64,QUJD',
        width: 20,
        height: 10
      }
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/png;base64,QUJD',
      width: 20,
      height: 10
    })
  })

  it('should not introduce midstream base64 padding when encoding large buffers', () => {
    var bytes = new Uint8Array(8200)
    for (var index = 0; index < bytes.length; index += 1) {
      bytes[index] = index % 251
    }

    var base64 = arrayBufferToBase64(bytes.buffer)
    var firstPaddingIndex = base64.indexOf('=')
    var hasMidstreamPadding = false

    if (firstPaddingIndex !== -1) {
      for (
        var paddingIndex = firstPaddingIndex;
        paddingIndex < base64.length;
        paddingIndex += 1
      ) {
        if (base64.charAt(paddingIndex) !== '=') {
          hasMidstreamPadding = true
          break
        }
      }
    }

    expect(firstPaddingIndex === -1 || firstPaddingIndex >= base64.length - 2).toBeTrue()
    expect(hasMidstreamPadding).toBeFalse()
  })

  it('should fallback the current request on runtime worker error and retry worker on later requests', async () => {
    var firstMessageHandler
    var firstErrorHandler
    var secondMessageHandler
    var secondErrorHandler
    var firstWorker = {
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        function (type, handler) {
          if (type === 'message') {
            firstMessageHandler = handler
          }
          if (type === 'error') {
            firstErrorHandler = handler
          }
        }
      ),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      postMessage: jasmine.createSpy('postMessage'),
      terminate: jasmine.createSpy('terminate')
    }
    var secondWorker = {
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        function (type, handler) {
          if (type === 'message') {
            secondMessageHandler = handler
          }
          if (type === 'error') {
            secondErrorHandler = handler
          }
        }
      ),
      removeEventListener: jasmine.createSpy('removeEventListener'),
      postMessage: jasmine.createSpy('postMessage'),
      terminate: jasmine.createSpy('terminate')
    }
    var createWorker = jasmine
      .createSpy('createWorker')
      .and.callFake(function () {
        return createWorker.calls.count() === 1 ? firstWorker : secondWorker
      })
    var bitmap = { close: jasmine.createSpy('close') }
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/webp;base64,MAIN')

    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve(bitmap)
        ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: createWorker
      }
    )

    var firstResultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()

    firstMessageHandler({
      data: {
        action: 'initialized',
        version: 'test'
      }
    })
    firstErrorHandler({
      error: new Error('runtime failed')
    })

    expect(await firstResultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,MAIN',
      width: 20,
      height: 10
    })
    await Promise.resolve()

    var secondResultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()

    expect(createWorker.calls.count()).toBe(2)
    secondMessageHandler({
      data: {
        action: 'initialized',
        version: 'test'
      }
    })
    var request = secondWorker.postMessage.calls.argsFor(1)[0]
    secondMessageHandler({
      data: {
        id: request.id,
        action: 'encoded',
        dataUrl: 'data:image/webp;base64,WORKER',
        width: 20,
        height: 10
      }
    })

    expect(await secondResultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,WORKER',
      width: 20,
      height: 10
    })
  })

  it('should permanently disable worker encoding after initialization failure', async () => {
    var workerHandle = createTestWorker()
    var createWorker = jasmine
      .createSpy('createWorker')
      .and.returnValue(workerHandle.worker)
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/webp;base64,MAIN')

    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve({ close: jasmine.createSpy('close') })
        ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: createWorker
      }
    )

    var firstResultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()

    workerHandle.emitError(new Error('init failed'))

    expect(await firstResultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,MAIN',
      width: 20,
      height: 10
    })
    await Promise.resolve()

    expect(createWorker.calls.count()).toBe(1)

    var secondResult = await bridge.encode(canvas)

    expect(secondResult).toEqual({
      dataUrl: 'data:image/webp;base64,MAIN',
      width: 20,
      height: 10
    })
    expect(createWorker.calls.count()).toBe(1)
  })

  it('should queue concurrent encode requests instead of rejecting them when busy', async () => {
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.returnValue(Promise.resolve({ close: jasmine.createSpy('close') }))
    var firstDeferred = {}
    var secondDeferred = {}
    var thirdDeferred = {}
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.callFake(function () {
        if (!firstDeferred.resolved) {
          firstDeferred.resolved = true
          return 'data:image/webp;base64,FIRST'
        }
        if (!secondDeferred.resolved) {
          secondDeferred.resolved = true
          return 'data:image/webp;base64,SECOND'
        }
        thirdDeferred.resolved = true
        return 'data:image/webp;base64,THIRD'
      })

    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: createImageBitmap,
        Worker: undefined,
        url: undefined
      }
    )

    var firstPromise = bridge.encode(canvas)
    var secondPromise = bridge.encode(canvas)
    var thirdPromise = bridge.encode(canvas)

    var firstResult = await firstPromise
    var secondResult = await secondPromise
    var thirdResult = await thirdPromise

    expect(firstResult.dataUrl).toBe('data:image/webp;base64,FIRST')
    expect(secondResult.dataUrl).toBe('data:image/webp;base64,SECOND')
    expect(thirdResult.dataUrl).toBe('data:image/webp;base64,THIRD')
    expect(canvas.toDataURL.calls.count()).toBe(3)
  })

  it('should reject queued encode requests when stopped', async () => {
    var workerHandle = createTestWorker()
    var firstRequestDeferred
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine
          .createSpy('createImageBitmap')
          .and.callFake(function () {
            firstRequestDeferred =
              firstRequestDeferred ||
              {}
            return new Promise(function (resolve) {
              firstRequestDeferred.resolve = resolve
            })
          }),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine.createSpy('createWorker').and.returnValue(workerHandle.worker)
      }
    )

    var firstPromise = bridge.encode(canvas)
    var secondPromise = bridge.encode(canvas)

    bridge.stop()

    await expectAsync(secondPromise).toBeRejectedWithError('Canvas encode bridge stopped')
    await expectAsync(firstPromise).toBeRejectedWithError('Canvas encode bridge stopped')
  })

  it('should reject new encode requests when the queue limit is reached', async () => {
    var firstRequestDeferred
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine
          .createSpy('createImageBitmap')
          .and.callFake(function () {
            firstRequestDeferred = firstRequestDeferred || {}
            return new Promise(function (resolve) {
              firstRequestDeferred.resolve = resolve
            })
          }),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine.createSpy('createWorker').and.returnValue(createTestWorker().worker)
      }
    )

    var activePromise = bridge.encode(canvas)
    var queuedPromises = []
    for (var index = 0; index < 50; index += 1) {
      queuedPromises.push(bridge.encode(canvas))
    }

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'Canvas encode bridge queue full'
    )

    bridge.stop()
    await expectAsync(activePromise).toBeRejectedWithError('Canvas encode bridge stopped')
    await Promise.all(
      queuedPromises.map(function (promise) {
        return expectAsync(promise).toBeRejectedWithError('Canvas encode bridge stopped')
      })
    )
  })
})
