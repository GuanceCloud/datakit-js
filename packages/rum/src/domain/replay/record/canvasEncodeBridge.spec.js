import {
  arrayBufferToBase64,
  createCanvasEncodeBridge
} from './canvasEncodeBridge'
import { CanvasEncodeWorkerStatus } from './canvasEncodeWorker'
import { setReplayCanvasContextType } from './canvasContext'

describe('replay/record/canvasEncodeBridge', () => {
  let canvas

  async function flushPromises() {
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
  }

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

  it('should not send known WebGL canvases through the 2d bridge without the addon', async () => {
    setReplayCanvasContextType(canvas, 'webgl')
    var toDataURL = spyOn(canvas, 'toDataURL')
    var bridge = createCanvasEncodeBridge({
      replayCanvasMaxConcurrentEncodes: 1
    })

    expect(await bridge.encode(canvas)).toEqual({
      ok: false,
      reason: 'webgl_plugin_missing'
    })
    expect(toDataURL).not.toHaveBeenCalled()
    bridge.stop()
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

  it('should preserve an explicit main-thread target above 16 MiB', async () => {
    canvas.width = 4096
    canvas.height = 4096
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      callback(new Blob(['ABC'], { type: 'image/webp' }))
    })
    var createElement = spyOn(document, 'createElement').and.callThrough()
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 4096,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    var result = await bridge.encode(canvas)

    expect(result.width).toBe(4096)
    expect(result.height).toBe(4096)
    expect(createElement).not.toHaveBeenCalledWith('canvas')
    expect(canvas.toBlob).toHaveBeenCalledTimes(1)
    bridge.stop()
  })

  it('should asynchronously encode the main-thread fallback through toBlob', async () => {
    canvas.toDataURL = jasmine.createSpy('toDataURL')
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      callback(new Blob(['ABC'], { type: 'image/png' }))
    })
    var bridge = createCanvasEncodeBridge(
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

    var result = await bridge.encode(canvas)

    expect(canvas.toBlob).toHaveBeenCalledWith(
      jasmine.any(Function),
      'image/webp',
      0.4
    )
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    expect(result).toEqual({
      dataUrl: 'data:image/png;base64,QUJD',
      width: 20,
      height: 10
    })
    bridge.stop()
  })

  it('should drop an oversized main-thread blob before creating a FileReader', async () => {
    var originalFileReader = globalThis.FileReader
    var FileReaderSpy = jasmine.createSpy('FileReader')
    globalThis.FileReader = FileReaderSpy
    var toBlob = spyOn(
      HTMLCanvasElement.prototype,
      'toBlob'
    ).and.callFake(function (callback) {
      callback({ size: 5, type: 'image/webp' })
    })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 4
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    try {
      expect(await bridge.encode(canvas)).toEqual({
        ok: false,
        reason: 'encode_too_large',
        encodedBytesCount: 5
      })
      expect(toBlob.calls.count()).toBe(1)
      expect(toBlob.calls.allArgs().map(function (args) {
        return args[2]
      })).toEqual([0.4])
      expect(FileReaderSpy).not.toHaveBeenCalled()
    } finally {
      bridge.stop()
      globalThis.FileReader = originalFileReader
    }
  })




  it('should preserve the actual main-thread data url mime type when toDataURL falls back', async () => {
    var originalToDataURL = canvas.toDataURL
    canvas.toBlob = undefined
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

  it('should drop an oversized toDataURL fallback before returning it to WebGL retry logic', async () => {
    var originalToDataURL = canvas.toDataURL
    canvas.toBlob = undefined
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/webp;base64,QUJDRA==')

    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxEncodedBytes: 5,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    expect(await bridge.encode(canvas)).toEqual({
      ok: false,
      reason: 'encode_too_large',
      encodedBytesCount: 6
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
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 123
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
    expect(request.maxEncodedBytes).toBe(123)
    expect(request.attemptLevel).toBeUndefined()
    expect(request.fallbackWidth).toBeUndefined()
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

  it('should preserve an explicit worker target above 16 MiB', async () => {
    canvas.width = 8192
    canvas.height = 4096
    var bitmap = { close: jasmine.createSpy('close') }
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.returnValue(Promise.resolve(bitmap))
    var workerHandle = createTestWorker()
    var createWorker = jasmine
      .createSpy('createWorker')
      .and.returnValue(workerHandle.worker)
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 4096,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: createImageBitmap,
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: createWorker
      }
    )

    var resultPromise = bridge.encode(canvas)
    await flushPromises()
    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      action: 'encoded',
      id: request.id,
      dataUrl: 'data:image/webp;base64,LARGE',
      width: 4096,
      height: 2048
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,LARGE',
      width: 4096,
      height: 2048
    })
    expect(createImageBitmap).toHaveBeenCalledTimes(1)
    expect(createWorker).toHaveBeenCalledTimes(1)
    bridge.stop()
  })

  it('should expose a typed worker drop result', async () => {
    var workerHandle = createTestWorker()
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 10
      },
      {
        createImageBitmap: jasmine
          .createSpy('createImageBitmap')
          .and.returnValue(
            Promise.resolve({ close: jasmine.createSpy('close') })
          ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine
          .createSpy('createWorker')
          .and.returnValue(workerHandle.worker)
      }
    )

    var resultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      id: request.id,
      action: 'dropped',
      reason: 'encode_too_large',
      encodedBytesCount: 11
    })

    expect(await resultPromise).toEqual({
      ok: false,
      reason: 'encode_too_large',
      encodedBytesCount: 11
    })
    bridge.stop()
  })

  it('should request a resized ImageBitmap before transferring a large canvas', async () => {
    canvas.width = 2000
    canvas.height = 1000
    var workerHandle = createTestWorker()
    var bitmap = { close: jasmine.createSpy('close') }
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.returnValue(Promise.resolve(bitmap))
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: createImageBitmap,
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine
          .createSpy('createWorker')
          .and.returnValue(workerHandle.worker)
      }
    )

    var resultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()

    expect(createImageBitmap).toHaveBeenCalledWith(canvas, {
      resizeWidth: 1000,
      resizeHeight: 500,
      resizeQuality: 'high'
    })
    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    expect(request.width).toBe(1000)
    expect(request.height).toBe(500)
    expect(request.attemptLevel).toBeUndefined()
    expect(request.fallbackWidth).toBeUndefined()

    workerHandle.emitMessage({
      id: request.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,RESIZED',
      width: 1000,
      height: 500
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,RESIZED',
      width: 1000,
      height: 500
    })
    bridge.stop()
  })













  it('should pre-resize before worker encoding when the ImageBitmap overload is unsupported', async () => {
    canvas.width = 2000
    canvas.height = 1000
    var workerHandle = createTestWorker()
    var bitmap = { close: jasmine.createSpy('close') }
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.callFake(function () {
        if (arguments.length > 1) {
          return Promise.reject(new TypeError('resize options unsupported'))
        }
        return Promise.resolve(bitmap)
      })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1000,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: createImageBitmap,
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine
          .createSpy('createWorker')
          .and.returnValue(workerHandle.worker)
      }
    )

    var resultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })

    expect(createImageBitmap.calls.count()).toBe(2)
    expect(createImageBitmap.calls.argsFor(1).length).toBe(1)
    expect(createImageBitmap.calls.argsFor(1)[0]).not.toBe(canvas)
    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      id: request.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,FALLBACK',
      width: 1000,
      height: 500
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,FALLBACK',
      width: 1000,
      height: 500
    })
    bridge.stop()
  })

  it('should preserve an explicit resize target above 16 MiB', async () => {
    canvas.width = 8192
    canvas.height = 2050
    var bitmap = { close: jasmine.createSpy('close') }
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.callFake(function () {
        if (arguments.length > 1) {
          return Promise.reject(
            new TypeError('resize options unsupported')
          )
        }
        return Promise.resolve(bitmap)
      })
    var workerHandle = createTestWorker()
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 4096,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: createImageBitmap,
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine
          .createSpy('createWorker')
          .and.returnValue(workerHandle.worker)
      }
    )

    var resultPromise = bridge.encode(canvas)
    await flushPromises()
    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      action: 'encoded',
      id: request.id,
      dataUrl: 'data:image/webp;base64,RESIZE',
      width: 4096,
      height: 1025
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,RESIZE',
      width: 4096,
      height: 1025
    })
    expect(createImageBitmap).toHaveBeenCalledTimes(2)
    expect(createImageBitmap.calls.argsFor(1).length).toBe(1)
    expect(createImageBitmap.calls.argsFor(1)[0]).not.toBe(canvas)
    bridge.stop()
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

  it('should back off worker recreation after a runtime error', async () => {
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
    var nowTime = 0
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/webp;base64,MAIN')
    canvas.toBlob = undefined

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
        createWorker: createWorker,
        now: function () {
          return nowTime
        }
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

    var backoffResult = await bridge.encode(canvas)
    expect(backoffResult).toEqual({
      dataUrl: 'data:image/webp;base64,MAIN',
      width: 20,
      height: 10
    })
    expect(createWorker.calls.count()).toBe(1)
    await Promise.resolve()

    nowTime = 60000
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


  it('should bound a caller waiting on a hung main-thread canvas encode', async () => {
    jasmine.clock().install()
    var blobCallback
    try {
      canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
        callback
      ) {
        blobCallback = callback
      })
      var bridge = createCanvasEncodeBridge(
        {
          replayCanvasMimeType: 'image/webp',
          replayCanvasQuality: 0.4,
          replayCanvasMaxCanvasSize: 1280,
          replayCanvasMaxConcurrentEncodes: 2,
          replayCanvasMaxEncodedBytes: 1000
        },
        {
          createImageBitmap: undefined,
          Worker: undefined,
          url: undefined
        }
      )
      var encodeLifecycle = bridge.encodeWithLifecycle(canvas)
      var encodeErrorPromise = encodeLifecycle.result.catch(function (error) {
        return error
      })
      var physicalSettled = false
      encodeLifecycle.physicalSettled.then(function () {
        physicalSettled = true
      })
      await Promise.resolve()
      await Promise.resolve()

      jasmine.clock().tick(10999)
      var settled = false
      encodeErrorPromise.then(function () {
        settled = true
      })
      await Promise.resolve()
      expect(settled).toBeFalse()

      jasmine.clock().tick(1)
      expect((await encodeErrorPromise).message).toBe(
        'Canvas encode request timed out'
      )
      await Promise.resolve()
      expect(physicalSettled).toBeFalse()

      // Let the uncancellable native work settle so the module-level physical
      // admission is released for later tests.
      blobCallback(new Blob([new Uint8Array(1001)], { type: 'image/webp' }))
      await encodeLifecycle.physicalSettled
      expect(physicalSettled).toBeTrue()
      bridge.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })


  it('should release the bridge slot when reset cancels hung native work', async () => {
    var blobCallbacks = []
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 2,
        replayCanvasMaxEncodedBytes: 1000
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    var firstErrorPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(1)

    bridge.reset()
    expect((await firstErrorPromise).message).toBe(
      'Canvas encode bridge reset'
    )

    var secondResultPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[1](
      new Blob([new Uint8Array(1001)], { type: 'image/webp' })
    )
    expect(await secondResultPromise).toEqual({
      ok: false,
      reason: 'encode_too_large',
      encodedBytesCount: 1001
    })

    // Settle the first uncancellable operation to release its shared physical
    // admission without ever publishing its stale result.
    blobCallbacks[0](
      new Blob([new Uint8Array(1001)], { type: 'image/webp' })
    )
    await Promise.resolve()
    await Promise.resolve()
    bridge.stop()
  })


  it('should permanently disable worker encoding after initialization failure', async () => {
    var workerHandle = createTestWorker()
    var createWorker = jasmine
      .createSpy('createWorker')
      .and.returnValue(workerHandle.worker)
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/webp;base64,MAIN')
    canvas.toBlob = undefined

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
    canvas.toBlob = undefined

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

  it('should preserve an explicit 2D encode concurrency above four', async () => {
    var blobCallbacks = []
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 6
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    var resultPromises = []
    for (var encodeIndex = 0; encodeIndex < 6; encodeIndex += 1) {
      resultPromises.push(bridge.encode(canvas))
    }
    await Promise.resolve()
    await Promise.resolve()

    expect(blobCallbacks.length).toBe(6)
    blobCallbacks.forEach(function (callback) {
      callback(new Blob(['A'], { type: 'image/webp' }))
    })
    expect((await Promise.all(resultPromises)).length).toBe(6)
    bridge.stop()
  })



  it('should not starve an older low-concurrency bridge', async () => {
    var blobCallbacks = []
    spyOn(HTMLCanvasElement.prototype, 'toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    function createBridge(maxConcurrentEncodes) {
      return createCanvasEncodeBridge(
        {
          replayCanvasMimeType: 'image/webp',
          replayCanvasQuality: 0.4,
          replayCanvasMaxCanvasSize: 1280,
          replayCanvasMaxConcurrentEncodes: maxConcurrentEncodes
        },
        {
          createImageBitmap: undefined,
          Worker: undefined,
          url: undefined
        }
      )
    }
    var highConcurrencyBridge = createBridge(6)
    var lowConcurrencyBridge = createBridge(1)
    var highFirst = highConcurrencyBridge.encode(canvas)
    var highSecond = highConcurrencyBridge.encode(canvas)
    var lowOldest = lowConcurrencyBridge.encode(canvas)
    var highLater = highConcurrencyBridge.encode(canvas)

    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[0](new Blob(['A'], { type: 'image/webp' }))
    await highFirst
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[1](new Blob(['B'], { type: 'image/webp' }))
    await highSecond
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(4)

    blobCallbacks[2](new Blob(['C'], { type: 'image/webp' }))
    await lowOldest
    blobCallbacks[3](new Blob(['D'], { type: 'image/webp' }))
    await highLater
    highConcurrencyBridge.stop()
    lowConcurrencyBridge.stop()
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

    firstRequestDeferred.resolve({ close: jasmine.createSpy('close') })
    await flushPromises()
  })

  it('should reset queued and active jobs without letting late completion corrupt concurrency', async () => {
    var blobCallbacks = []
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 1000
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    var activeResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    var queuedResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(1)

    bridge.reset()
    expect(await activeResultPromise).toEqual(
      jasmine.objectContaining({ message: 'Canvas encode bridge reset' })
    )
    expect(await queuedResultPromise).toEqual(
      jasmine.objectContaining({ message: 'Canvas encode bridge reset' })
    )

    var newBaselinePromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(1)

    blobCallbacks[0](
      new Blob([new Uint8Array(1001)], { type: 'image/webp' })
    )
    await flushPromises()
    expect(blobCallbacks.length).toBe(2)

    var queuedAfterResetPromise = bridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[1](new Blob(['NEW'], { type: 'image/webp' }))
    expect((await newBaselinePromise).dataUrl).toBe(
      'data:image/webp;base64,TkVX'
    )
    await flushPromises()
    expect(blobCallbacks.length).toBe(3)

    blobCallbacks[2](new Blob(['NEXT'], { type: 'image/webp' }))
    expect((await queuedAfterResetPromise).dataUrl).toBe(
      'data:image/webp;base64,TkVYVA=='
    )
    bridge.stop()
  })

  it('should keep a held toBlob encode admitted across repeated resets', async () => {
    var blobCallbacks = []
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 1000
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    var currentPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(1)

    for (var resetIndex = 0; resetIndex < 3; resetIndex += 1) {
      bridge.reset()
      expect(await currentPromise).toEqual(
        jasmine.objectContaining({ message: 'Canvas encode bridge reset' })
      )
      currentPromise = bridge.encode(canvas).catch(function (error) {
        return error
      })
      await Promise.resolve()
      await Promise.resolve()
      expect(blobCallbacks.length).toBe(1)
    }

    blobCallbacks[0](
      new Blob([new Uint8Array(1001)], { type: 'image/webp' })
    )
    await flushPromises()
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[1](new Blob(['FRESH'], { type: 'image/webp' }))
    expect(await currentPromise).toEqual(
      jasmine.objectContaining({
        dataUrl: 'data:image/webp;base64,RlJFU0g='
      })
    )
    bridge.stop()
  })

  it('should isolate physical encode admission across bridge restarts', async () => {
    var blobCallbacks = []
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var configuration = {
      replayCanvasMimeType: 'image/webp',
      replayCanvasQuality: 0.4,
      replayCanvasMaxCanvasSize: 1280,
      replayCanvasMaxConcurrentEncodes: 1,
      replayCanvasMaxEncodedBytes: 1000
    }
    var bridgeOptions = {
      createImageBitmap: undefined,
      Worker: undefined,
      url: undefined
    }
    var firstBridge = createCanvasEncodeBridge(
      configuration,
      bridgeOptions
    )
    var firstResultPromise = firstBridge
      .encode(canvas)
      .catch(function (error) {
        return error
      })
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(1)

    firstBridge.stop()
    expect(await firstResultPromise).toEqual(
      jasmine.objectContaining({ message: 'Canvas encode bridge stopped' })
    )

    var secondBridge = createCanvasEncodeBridge(
      configuration,
      bridgeOptions
    )
    var secondResultPromise = secondBridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()

    expect(blobCallbacks.length).toBe(1)

    blobCallbacks[0](
      new Blob([new Uint8Array(1001)], { type: 'image/webp' })
    )
    await flushPromises()
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[1](new Blob(['FRESH'], { type: 'image/webp' }))
    expect(await secondResultPromise).toEqual(
      jasmine.objectContaining({
        dataUrl: 'data:image/webp;base64,RlJFU0g='
      })
    )
    secondBridge.stop()
  })

  it('should not grow native work or the shared queue while a quarantined encode is hung', async () => {
    var blobCallbacks = []
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var configuration = {
      replayCanvasMimeType: 'image/webp',
      replayCanvasQuality: 0.4,
      replayCanvasMaxCanvasSize: 1280,
      replayCanvasMaxConcurrentEncodes: 1,
      replayCanvasMaxEncodedBytes: 1000
    }
    var bridgeOptions = {
      createImageBitmap: undefined,
      Worker: undefined,
      url: undefined
    }
    var firstBridge = createCanvasEncodeBridge(configuration, bridgeOptions)
    var firstLifecycle = firstBridge.encodeWithLifecycle(canvas)
    var firstErrorPromise = firstLifecycle.result.catch(function (error) {
      return error
    })
    var firstPhysicalSettled = false
    firstLifecycle.physicalSettled.then(function () {
      firstPhysicalSettled = true
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(1)

    firstBridge.stop()
    expect(await firstErrorPromise).toEqual(
      jasmine.objectContaining({ message: 'Canvas encode bridge stopped' })
    )
    await Promise.resolve()
    expect(firstPhysicalSettled).toBeFalse()

    for (var attempt = 0; attempt < 70; attempt += 1) {
      var blockedBridge = createCanvasEncodeBridge(
        configuration,
        bridgeOptions
      )
      var blockedErrorPromise = blockedBridge.encode(canvas).catch(function (error) {
        return error
      })
      await Promise.resolve()
      expect(blobCallbacks.length).toBe(1)
      blockedBridge.stop()
      expect(await blockedErrorPromise).toEqual(
        jasmine.objectContaining({ message: 'Canvas encode bridge stopped' })
      )
    }
    expect(blobCallbacks.length).toBe(1)

    blobCallbacks[0](new Blob(['STALE'], { type: 'image/webp' }))
    await firstLifecycle.physicalSettled
    expect(firstPhysicalSettled).toBeTrue()

    var recoveredBridge = createCanvasEncodeBridge(
      configuration,
      bridgeOptions
    )
    var recoveredResultPromise = recoveredBridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(2)
    blobCallbacks[1](new Blob(['FRESH'], { type: 'image/webp' }))
    expect(await recoveredResultPromise).toEqual(
      jasmine.objectContaining({
        dataUrl: 'data:image/webp;base64,RlJFU0g='
      })
    )
    recoveredBridge.stop()
  })

  it('should keep quarantined native work in the shared concurrency count until it settles', async () => {
    var blobCallbacks = []
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
      blobCallbacks.push(callback)
    })
    var configuration = {
      replayCanvasMimeType: 'image/webp',
      replayCanvasQuality: 0.4,
      replayCanvasMaxCanvasSize: 1280,
      replayCanvasMaxConcurrentEncodes: 2,
      replayCanvasMaxEncodedBytes: 1000
    }
    var bridgeOptions = {
      createImageBitmap: undefined,
      Worker: undefined,
      url: undefined
    }
    var firstBridge = createCanvasEncodeBridge(configuration, bridgeOptions)
    var firstLifecycle = firstBridge.encodeWithLifecycle(canvas)
    var secondLifecycle = firstBridge.encodeWithLifecycle(canvas)
    var firstResult = firstLifecycle.result.catch(function (error) {
      return error
    })
    var secondResult = secondLifecycle.result.catch(function (error) {
      return error
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(2)

    firstBridge.stop()
    await Promise.all([firstResult, secondResult])

    blobCallbacks[1](new Blob(['SECOND'], { type: 'image/webp' }))
    await secondLifecycle.physicalSettled
    var stillBlockedBridge = createCanvasEncodeBridge(
      Object.assign({}, configuration, {
        replayCanvasMaxConcurrentEncodes: 1
      }),
      bridgeOptions
    )
    var stillBlockedResult = stillBlockedBridge.encode(canvas)
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(2)

    blobCallbacks[0](new Blob(['FIRST'], { type: 'image/webp' }))
    await firstLifecycle.physicalSettled
    await Promise.resolve()
    await Promise.resolve()
    expect(blobCallbacks.length).toBe(3)
    blobCallbacks[2](new Blob(['FRESH'], { type: 'image/webp' }))
    await expectAsync(stillBlockedResult).toBeResolved()
    stillBlockedBridge.stop()
  })


  it('should ignore a late worker response after reset and use a fresh worker', async () => {
    var firstWorkerHandle = createTestWorker()
    var secondWorkerHandle = createTestWorker()
    var createWorker = jasmine
      .createSpy('createWorker')
      .and.returnValues(firstWorkerHandle.worker, secondWorkerHandle.worker)
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 1000
      },
      {
        createImageBitmap: jasmine
          .createSpy('createImageBitmap')
          .and.callFake(function () {
            return Promise.resolve({ close: jasmine.createSpy('close') })
          }),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: createWorker
      }
    )

    var staleResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    await Promise.resolve()
    await Promise.resolve()
    var staleRequest =
      firstWorkerHandle.worker.postMessage.calls.argsFor(1)[0]

    bridge.reset()
    expect(await staleResultPromise).toEqual(
      jasmine.objectContaining({ message: 'Canvas encode bridge reset' })
    )
    expect(firstWorkerHandle.worker.terminate).toHaveBeenCalledTimes(1)

    var freshResolved = false
    var freshResultPromise = bridge.encode(canvas).then(function (result) {
      freshResolved = true
      return result
    })
    await flushPromises()
    var freshRequest =
      secondWorkerHandle.worker.postMessage.calls.argsFor(1)[0]

    firstWorkerHandle.emitMessage({
      id: staleRequest.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,OLD',
      width: 20,
      height: 10
    })
    await Promise.resolve()
    expect(freshResolved).toBeFalse()

    secondWorkerHandle.emitMessage({
      id: freshRequest.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,NEW',
      width: 20,
      height: 10
    })
    expect(await freshResultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,NEW',
      width: 20,
      height: 10
    })
    expect(createWorker).toHaveBeenCalledTimes(2)
    bridge.stop()
  })

  it('should close a delayed bitmap without creating a worker after stop', async () => {
    var resolveBitmap
    var bitmap = { close: jasmine.createSpy('close') }
    var createWorker = jasmine
      .createSpy('createWorker')
      .and.returnValue(createTestWorker().worker)
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
          .and.returnValue(
            new Promise(function (resolve) {
              resolveBitmap = resolve
            })
          ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine
            .createSpy('createObjectURL')
            .and.returnValue('blob:test'),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: createWorker
      }
    )

    var resultPromise = bridge.encode(canvas)
    bridge.stop()
    await expectAsync(resultPromise).toBeRejectedWithError(
      'Canvas encode bridge stopped'
    )

    resolveBitmap(bitmap)
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(createWorker).not.toHaveBeenCalled()
    expect(bitmap.close).toHaveBeenCalledTimes(1)
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
    firstRequestDeferred.resolve({ close: jasmine.createSpy('close') })
    await flushPromises()
  })
})
