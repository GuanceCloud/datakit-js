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

  it('should reject an oversized main-thread target before allocating a resize canvas', async () => {
    canvas.width = 8192
    canvas.height = 4096
    canvas.toBlob = jasmine.createSpy('toBlob')
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

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'Canvas encode bridge target memory budget exceeded'
    )
    expect(createElement).not.toHaveBeenCalledWith('canvas')
    expect(canvas.toBlob).not.toHaveBeenCalled()
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
    canvas.toBlob = jasmine.createSpy('toBlob').and.callFake(function (
      callback
    ) {
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

  it('should synchronously copy WebGL pixels before main-thread fallback encoding', async () => {
    canvas.width = 1
    canvas.height = 1
    var originalGetContext = canvas.getContext.bind(canvas)
    var webGLContext = {
      FRAMEBUFFER: 36160,
      FRAMEBUFFER_BINDING: 36006,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      drawingBufferWidth: 1,
      drawingBufferHeight: 1,
      getParameter: jasmine.createSpy('getParameter').and.returnValue(null),
      bindFramebuffer: jasmine.createSpy('bindFramebuffer'),
      readPixels: jasmine.createSpy('readPixels').and.callFake(function (
        _x,
        _y,
        _width,
        _height,
        _format,
        _type,
        pixels
      ) {
        pixels.set([220, 30, 40, 255])
      })
    }
    canvas.getContext = jasmine.createSpy('getContext').and.callFake(function (
      contextType
    ) {
      return contextType === 'webgl'
        ? webGLContext
        : originalGetContext(contextType)
    })
    canvas.toDataURL = jasmine.createSpy('sourceToDataURL')
    setReplayCanvasContextType(canvas, 'webgl')
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

    var resultPromise = bridge.encode(canvas)

    expect(webGLContext.readPixels).not.toHaveBeenCalled()
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    var result = await resultPromise
    expect(result.width).toBe(1)
    expect(result.height).toBe(1)
    expect(result.dataUrl).toMatch(/^data:image\/(webp|png);base64,/)
    bridge.stop()
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

  it('should reject an oversized worker target before creating an ImageBitmap', async () => {
    canvas.width = 8192
    canvas.height = 4096
    var createImageBitmap = jasmine.createSpy('createImageBitmap')
    var createWorker = jasmine.createSpy('createWorker')
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

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'Canvas encode bridge target memory budget exceeded'
    )
    expect(createImageBitmap).not.toHaveBeenCalled()
    expect(createWorker).not.toHaveBeenCalled()
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

  it('should synchronously stage WebGL pixels before resizing them in the worker', async () => {
    canvas.width = 2000
    canvas.height = 1000
    var sourceContext = canvas.getContext('2d')
    sourceContext.fillStyle = 'rgb(255, 0, 0)'
    sourceContext.fillRect(0, 0, canvas.width, canvas.height)
    setReplayCanvasContextType(canvas, 'webgl')
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

    var stagedCanvas = createImageBitmap.calls.argsFor(0)[0]
    expect(stagedCanvas).not.toBe(canvas)
    expect(stagedCanvas.width).toBe(1000)
    expect(stagedCanvas.height).toBe(500)
    expect(
      Array.from(
        stagedCanvas.getContext('2d').getImageData(0, 0, 1, 1).data
      )
    ).toEqual([255, 0, 0, 255])
    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    expect(request.width).toBe(1000)
    expect(request.height).toBe(500)

    workerHandle.emitMessage({
      id: request.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,WEBGL',
      width: 1000,
      height: 500
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,WEBGL',
      width: 1000,
      height: 500
    })
    bridge.stop()
  })

  it('should stage a queued WebGL frame immediately while another encode is busy', async () => {
    canvas.width = 1
    canvas.height = 1
    var sourceContext = canvas.getContext('2d')
    sourceContext.fillStyle = 'rgb(255, 0, 0)'
    sourceContext.fillRect(0, 0, 1, 1)
    setReplayCanvasContextType(canvas, 'webgl')
    var bitmapRequests = []
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.callFake(function (stagingCanvas) {
        return new Promise(function (resolve) {
          bitmapRequests.push({
            stagingCanvas: stagingCanvas,
            resolve: resolve
          })
        })
      })
    var workerHandle = createTestWorker()
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
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

    var firstResultPromise = bridge.encode(canvas)
    sourceContext.fillStyle = 'rgb(0, 255, 0)'
    sourceContext.fillRect(0, 0, 1, 1)
    var secondResultPromise = bridge.encode(canvas)
    sourceContext.fillStyle = 'rgb(0, 0, 255)'
    sourceContext.fillRect(0, 0, 1, 1)

    expect(createImageBitmap.calls.count()).toBe(1)
    bitmapRequests[0].resolve({ close: jasmine.createSpy('close') })
    await Promise.resolve()
    await Promise.resolve()
    var firstRequest = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      id: firstRequest.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,FIRST',
      width: 1,
      height: 1
    })
    expect(await firstResultPromise).toEqual(
      jasmine.objectContaining({
        dataUrl: 'data:image/webp;base64,FIRST'
      })
    )
    await flushPromises()

    expect(createImageBitmap.calls.count()).toBe(2)
    expect(
      Array.from(
        bitmapRequests[1].stagingCanvas
          .getContext('2d')
          .getImageData(0, 0, 1, 1).data
      )
    ).toEqual([0, 255, 0, 255])

    bitmapRequests[1].resolve({ close: jasmine.createSpy('close') })
    await Promise.resolve()
    await Promise.resolve()
    var secondRequest = workerHandle.worker.postMessage.calls.argsFor(2)[0]
    workerHandle.emitMessage({
      id: secondRequest.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,SECOND',
      width: 1,
      height: 1
    })
    expect(await secondResultPromise).toEqual(
      jasmine.objectContaining({
        dataUrl: 'data:image/webp;base64,SECOND'
      })
    )
    bridge.stop()
  })

  it('should cap retained WebGL staging surfaces at twice the encode concurrency', async () => {
    canvas.width = 1
    canvas.height = 1
    canvas.getContext('2d').fillRect(0, 0, 1, 1)
    setReplayCanvasContextType(canvas, 'webgl')
    var bitmapRequests = []
    var workerHandle = createTestWorker()
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
            return new Promise(function (resolve) {
              bitmapRequests.push({ resolve: resolve })
            })
          }),
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

    var firstResultPromise = bridge.encode(canvas)
    var secondResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    var overflowResults = []
    for (var requestIndex = 0; requestIndex < 20; requestIndex += 1) {
      overflowResults.push(
        bridge.encode(canvas).catch(function (error) {
          return error
        })
      )
    }

    expect(bitmapRequests.length).toBe(1)
    var overflowErrors = await Promise.all(overflowResults)
    overflowErrors.forEach(function (error) {
      expect(error.message).toBe(
        'Canvas encode bridge WebGL staging queue full'
      )
    })

    bitmapRequests[0].resolve({ close: jasmine.createSpy('close') })
    await Promise.resolve()
    await Promise.resolve()
    var firstRequest = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      id: firstRequest.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,FIRST',
      width: 1,
      height: 1
    })
    await firstResultPromise
    await flushPromises()

    expect(bitmapRequests.length).toBe(2)
    var thirdResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'Canvas encode bridge WebGL staging queue full'
    )

    bridge.stop()
    expect((await secondResultPromise).message).toBe(
      'Canvas encode bridge stopped'
    )
    expect((await thirdResultPromise).message).toBe(
      'Canvas encode bridge stopped'
    )
    bitmapRequests[1].resolve({ close: jasmine.createSpy('close') })
    await flushPromises()
  })

  it('should cap the total WebGL staging backing stores by bytes', async () => {
    canvas.width = 1500
    canvas.height = 1000
    canvas.getContext('2d').fillRect(0, 0, 1, 1)
    setReplayCanvasContextType(canvas, 'webgl')
    var bitmapRequests = []
    var workerHandle = createTestWorker()
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1500,
        replayCanvasMaxConcurrentEncodes: 2
      },
      {
        createImageBitmap: jasmine
          .createSpy('createImageBitmap')
          .and.callFake(function () {
            return new Promise(function (resolve) {
              bitmapRequests.push({ resolve: resolve })
            })
          }),
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

    var firstResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    var secondResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'Canvas encode bridge WebGL staging memory budget exceeded'
    )
    expect(bitmapRequests.length).toBe(2)

    bridge.stop()
    bitmapRequests.forEach(function (request) {
      request.resolve({ close: jasmine.createSpy('close') })
    })
    expect((await firstResultPromise).message).toBe(
      'Canvas encode bridge stopped'
    )
    expect((await secondResultPromise).message).toBe(
      'Canvas encode bridge stopped'
    )
    await flushPromises()
  })

  it('should reject an empty WebGL drawing buffer before reading pixels', async () => {
    canvas.width = 1
    canvas.height = 1
    var originalGetContext = canvas.getContext.bind(canvas)
    var webGLContext = {
      drawingBufferWidth: 0,
      drawingBufferHeight: 0,
      isContextLost: jasmine
        .createSpy('isContextLost')
        .and.returnValue(false),
      readPixels: jasmine.createSpy('readPixels')
    }
    canvas.getContext = jasmine.createSpy('getContext').and.callFake(function (
      contextType
    ) {
      return contextType === 'webgl'
        ? webGLContext
        : originalGetContext(contextType)
    })
    setReplayCanvasContextType(canvas, 'webgl')
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

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'WebGL drawing buffer is empty'
    )
    expect(webGLContext.readPixels).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('should reject a lost WebGL context before copying its backing store', async () => {
    var originalGetContext = canvas.getContext.bind(canvas)
    var webGLContext = {
      drawingBufferWidth: 20,
      drawingBufferHeight: 10,
      isContextLost: jasmine
        .createSpy('isContextLost')
        .and.returnValue(true),
      readPixels: jasmine.createSpy('readPixels')
    }
    canvas.getContext = jasmine.createSpy('getContext').and.callFake(function (
      contextType
    ) {
      return contextType === 'webgl'
        ? webGLContext
        : originalGetContext(contextType)
    })
    setReplayCanvasContextType(canvas, 'webgl')
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

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'WebGL context is lost'
    )
    expect(webGLContext.readPixels).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('should reject a 4K readback before allocating pixel arrays or calling readPixels', async () => {
    var originalGetContext = canvas.getContext.bind(canvas)
    var webGLContext = {
      drawingBufferWidth: 3840,
      drawingBufferHeight: 2160,
      isContextLost: jasmine
        .createSpy('isContextLost')
        .and.returnValue(false),
      readPixels: jasmine.createSpy('readPixels')
    }
    canvas.getContext = jasmine.createSpy('getContext').and.callFake(function (
      contextType
    ) {
      return contextType === 'webgl'
        ? webGLContext
        : originalGetContext(contextType)
    })
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.throwError(
      'WebGL canvas copy is unavailable'
    )
    setReplayCanvasContextType(canvas, 'webgl')
    var createWebGLReadbackState = jasmine.createSpy(
      'createWebGLReadbackState'
    )
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
        url: undefined,
        createWebGLReadbackState: createWebGLReadbackState
      }
    )

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'WebGL replay readback exceeds the peak memory limit'
    )
    expect(createWebGLReadbackState).not.toHaveBeenCalled()
    expect(webGLContext.readPixels).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('should read, vertically flip, and stage the default WebGL framebuffer', async () => {
    canvas.width = 2
    canvas.height = 2
    var originalGetContext = canvas.getContext.bind(canvas)
    var previousReadFramebuffer = { id: 'read-framebuffer' }
    var previousPixelPackBuffer = { id: 'pixel-pack-buffer' }
    var webGLContext = {
      FRAMEBUFFER: 36160,
      FRAMEBUFFER_BINDING: 36006,
      READ_FRAMEBUFFER: 36008,
      READ_FRAMEBUFFER_BINDING: 36010,
      PIXEL_PACK_BUFFER: 35051,
      PIXEL_PACK_BUFFER_BINDING: 35053,
      PACK_ALIGNMENT: 3333,
      PACK_ROW_LENGTH: 3330,
      PACK_SKIP_ROWS: 3331,
      PACK_SKIP_PIXELS: 3332,
      RGBA: 6408,
      UNSIGNED_BYTE: 5121,
      drawingBufferWidth: 2,
      drawingBufferHeight: 2,
      getParameter: jasmine.createSpy('getParameter').and.callFake(function (
        parameter
      ) {
        if (parameter === 36010) {
          return previousReadFramebuffer
        }
        if (parameter === 35053) {
          return previousPixelPackBuffer
        }
        return {
          3333: 8,
          3330: 7,
          3331: 3,
          3332: 4
        }[parameter]
      }),
      bindFramebuffer: jasmine.createSpy('bindFramebuffer'),
      bindBuffer: jasmine.createSpy('bindBuffer'),
      pixelStorei: jasmine.createSpy('pixelStorei'),
      readPixels: jasmine.createSpy('readPixels').and.callFake(function (
        _x,
        _y,
        _width,
        _height,
        _format,
        _type,
        pixels
      ) {
        pixels.set([
          0,
          0,
          255,
          255,
          255,
          255,
          255,
          255,
          255,
          0,
          0,
          255,
          0,
          255,
          0,
          255
        ])
      })
    }
    canvas.getContext = jasmine.createSpy('getContext').and.callFake(function (
      contextType
    ) {
      return contextType === 'webgl'
        ? webGLContext
        : originalGetContext(contextType)
    })
    spyOn(CanvasRenderingContext2D.prototype, 'drawImage').and.throwError(
      'WebGL canvas copy is unavailable'
    )
    setReplayCanvasContextType(canvas, 'webgl')
    var workerHandle = createTestWorker()
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.returnValue(Promise.resolve({ close: jasmine.createSpy('close') }))
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 2,
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

    var stagedCanvas = createImageBitmap.calls.argsFor(0)[0]
    var stagedPixels = stagedCanvas
      .getContext('2d')
      .getImageData(0, 0, 2, 2).data
    expect(Array.from(stagedPixels)).toEqual([
      255,
      0,
      0,
      255,
      0,
      255,
      0,
      255,
      0,
      0,
      255,
      255,
      255,
      255,
      255,
      255
    ])
    expect(webGLContext.bindFramebuffer.calls.argsFor(0)).toEqual([
      webGLContext.READ_FRAMEBUFFER,
      null
    ])
    expect(webGLContext.bindFramebuffer.calls.argsFor(1)).toEqual([
      webGLContext.READ_FRAMEBUFFER,
      previousReadFramebuffer
    ])
    expect(webGLContext.bindBuffer.calls.argsFor(0)).toEqual([
      webGLContext.PIXEL_PACK_BUFFER,
      null
    ])
    expect(webGLContext.bindBuffer.calls.argsFor(1)).toEqual([
      webGLContext.PIXEL_PACK_BUFFER,
      previousPixelPackBuffer
    ])
    expect(webGLContext.pixelStorei.calls.allArgs()).toEqual([
      [webGLContext.PACK_ALIGNMENT, 1],
      [webGLContext.PACK_ROW_LENGTH, 0],
      [webGLContext.PACK_SKIP_ROWS, 0],
      [webGLContext.PACK_SKIP_PIXELS, 0],
      [webGLContext.PACK_SKIP_PIXELS, 4],
      [webGLContext.PACK_SKIP_ROWS, 3],
      [webGLContext.PACK_ROW_LENGTH, 7],
      [webGLContext.PACK_ALIGNMENT, 8]
    ])
    expect(webGLContext.readPixels.calls.argsFor(0).slice(0, 4)).toEqual([
      0,
      0,
      2,
      2
    ])

    var request = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      id: request.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,READBACK',
      width: 2,
      height: 2
    })
    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,READBACK',
      width: 2,
      height: 2
    })
    bridge.stop()
  })

  it('should not reread a WebGL canvas after an asynchronous worker failure', async () => {
    setReplayCanvasContextType(canvas, 'webgl')
    canvas.toDataURL = jasmine
      .createSpy('toDataURL')
      .and.returnValue('data:image/webp;base64,BLANK')
    var workerHandle = createTestWorker()
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
      action: 'errored',
      error: 'worker encode failed'
    })

    await expectAsync(resultPromise).toBeRejectedWithError(
      'worker encode failed'
    )
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('should not reread a WebGL canvas after bitmap capture fails', async () => {
    setReplayCanvasContextType(canvas, 'webgl')
    canvas.toDataURL = jasmine.createSpy('toDataURL')
    var captureError = new Error('bitmap capture failed')
    var createWorker = jasmine.createSpy('createWorker')
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
          .and.returnValue(Promise.reject(captureError)),
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

    await expectAsync(bridge.encode(canvas)).toBeRejectedWith(captureError)
    expect(canvas.toDataURL).not.toHaveBeenCalled()
    expect(createWorker).not.toHaveBeenCalled()
    bridge.stop()
  })

  it('should use bounded resize staging when the ImageBitmap overload is unsupported', async () => {
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
    var stagingCanvas = createImageBitmap.calls.argsFor(1)[0]
    expect(stagingCanvas).not.toBe(canvas)
    expect(stagingCanvas.width).toBe(1000)
    expect(stagingCanvas.height).toBe(500)
    expect(createImageBitmap.calls.argsFor(1)).toEqual([stagingCanvas])
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

  it('should reject a resize target above 16 MiB before ImageBitmap allocation', async () => {
    canvas.width = 8192
    canvas.height = 2050
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.callFake(function () {
        return Promise.reject(new TypeError('resize options unsupported'))
      })
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
        createWorker: jasmine.createSpy('createWorker')
      }
    )

    await expectAsync(bridge.encode(canvas)).toBeRejectedWithError(
      'Canvas encode bridge target memory budget exceeded'
    )
    expect(createImageBitmap).not.toHaveBeenCalled()
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

  it('should time out all pending worker requests and recover through backoff', async () => {
    jasmine.clock().install()
    try {
      setReplayCanvasContextType(canvas, 'webgl')
      canvas.toDataURL = jasmine
        .createSpy('toDataURL')
        .and.returnValue('data:image/webp;base64,RECOVERED')
      var workerHandle = createTestWorker()
      var createWorker = jasmine
        .createSpy('createWorker')
        .and.returnValue(workerHandle.worker)
      var bridge = createCanvasEncodeBridge(
        {
          replayCanvasMimeType: 'image/webp',
          replayCanvasQuality: 0.4,
          replayCanvasMaxCanvasSize: 1280,
          replayCanvasMaxConcurrentEncodes: 2
        },
        {
          createImageBitmap: jasmine
            .createSpy('createImageBitmap')
            .and.callFake(function () {
              return Promise.resolve({
                close: jasmine.createSpy('close')
              })
            }),
          Worker: function FakeWorker() {},
          url: {
            createObjectURL: jasmine
              .createSpy('createObjectURL')
              .and.returnValue('blob:test'),
            revokeObjectURL: jasmine.createSpy('revokeObjectURL')
          },
          createWorker: createWorker,
          now: function () {
            return 0
          }
        }
      )

      var firstErrorPromise = bridge.encode(canvas).catch(function (error) {
        return error
      })
      var secondErrorPromise = bridge.encode(canvas).catch(function (error) {
        return error
      })
      await Promise.resolve()
      await Promise.resolve()
      workerHandle.emitMessage({
        action: 'initialized',
        version: 'test'
      })

      jasmine.clock().tick(9999)
      expect(workerHandle.worker.terminate).not.toHaveBeenCalled()
      jasmine.clock().tick(1)

      expect((await firstErrorPromise).message).toBe(
        'Canvas encode worker request timed out'
      )
      expect((await secondErrorPromise).message).toBe(
        'Canvas encode worker request timed out'
      )
      expect(workerHandle.worker.terminate).toHaveBeenCalledTimes(1)

      var recoveredResult = await bridge.encode(canvas)
      expect(recoveredResult.width).toBe(20)
      expect(recoveredResult.height).toBe(10)
      expect(recoveredResult.dataUrl).toMatch(
        /^data:image\/(webp|png);base64,/
      )
      expect(canvas.toDataURL).not.toHaveBeenCalled()
      expect(createWorker).toHaveBeenCalledTimes(1)
      bridge.stop()
    } finally {
      jasmine.clock().uninstall()
    }
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
      var encodeErrorPromise = bridge.encode(canvas).catch(function (error) {
        return error
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

      // Let the uncancellable native work settle so the module-level physical
      // admission is released for later tests.
      blobCallback(new Blob([new Uint8Array(1001)], { type: 'image/webp' }))
      await Promise.resolve()
      await Promise.resolve()
      bridge.stop()
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should release the bridge slot when reset cancels hung native work', async () => {
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

  it('should reject every pending request when worker postMessage throws', async () => {
    setReplayCanvasContextType(canvas, 'webgl')
    var workerHandle = createTestWorker()
    var postMessageError = new Error('postMessage failed')
    var encodePostCount = 0
    workerHandle.worker.postMessage.and.callFake(function (message) {
      if (message.action === 'encode') {
        encodePostCount += 1
        if (encodePostCount === 2) {
          throw postMessageError
        }
      }
    })
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 2
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
        createWorker: jasmine
          .createSpy('createWorker')
          .and.returnValue(workerHandle.worker)
      }
    )

    var firstResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    var secondResultPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    await Promise.resolve()
    await Promise.resolve()
    await Promise.resolve()

    expect(await firstResultPromise).toBe(postMessageError)
    expect(await secondResultPromise).toBe(postMessageError)
    expect(workerHandle.worker.terminate).toHaveBeenCalledTimes(1)
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

  it('should share physical encode admission across bridge restarts', async () => {
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

  it('should keep a held WebGL bitmap capture admitted across repeated resets', async () => {
    canvas.width = 1
    canvas.height = 1
    canvas.getContext('2d').fillRect(0, 0, 1, 1)
    setReplayCanvasContextType(canvas, 'webgl')
    var bitmapRequests = []
    var createImageBitmap = jasmine
      .createSpy('createImageBitmap')
      .and.callFake(function (stagingCanvas) {
        return new Promise(function (resolve) {
          bitmapRequests.push({
            resolve: resolve,
            stagingCanvas: stagingCanvas
          })
        })
      })
    var workerHandle = createTestWorker()
    var bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasMaxEncodedBytes: 1000
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

    var currentPromise = bridge.encode(canvas).catch(function (error) {
      return error
    })
    expect(createImageBitmap.calls.count()).toBe(1)

    for (var resetIndex = 0; resetIndex < 3; resetIndex += 1) {
      bridge.reset()
      expect(await currentPromise).toEqual(
        jasmine.objectContaining({ message: 'Canvas encode bridge reset' })
      )
      currentPromise = bridge.encode(canvas).catch(function (error) {
        return error
      })
      await Promise.resolve()
      expect(createImageBitmap.calls.count()).toBe(1)
    }

    var staleBitmap = { close: jasmine.createSpy('close') }
    bitmapRequests[0].resolve(staleBitmap)
    await flushPromises()

    expect(staleBitmap.close).toHaveBeenCalledTimes(1)
    expect(createImageBitmap.calls.count()).toBe(2)
    expect(bitmapRequests[1].stagingCanvas).not.toBe(canvas)

    bitmapRequests[1].resolve({ close: jasmine.createSpy('close') })
    await Promise.resolve()
    await Promise.resolve()
    var freshRequest = workerHandle.worker.postMessage.calls.argsFor(1)[0]
    workerHandle.emitMessage({
      action: 'initialized',
      version: 'test'
    })
    workerHandle.emitMessage({
      id: freshRequest.id,
      action: 'encoded',
      dataUrl: 'data:image/webp;base64,FRESH',
      width: 1,
      height: 1
    })

    expect(await currentPromise).toEqual(
      jasmine.objectContaining({
        dataUrl: 'data:image/webp;base64,FRESH'
      })
    )
    bridge.stop()
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
