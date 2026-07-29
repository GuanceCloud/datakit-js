import {
  MAX_CANVAS_POOL_PIXEL_BYTES,
  startCanvasWorker
} from './startCanvasWorker'

describe('worker/startCanvasWorker', () => {
  let originalBuildEnvVersion
  let originalSelf
  let originalOffscreenCanvas

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'canvas-worker-test-version'
    originalSelf = globalThis.self
    originalOffscreenCanvas = globalThis.OffscreenCanvas
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
    globalThis.self = originalSelf
    globalThis.OffscreenCanvas = originalOffscreenCanvas
  })

  function createWorkerScope(postMessageImpl) {
    return {
      listener: undefined,
      addEventListener(type, listener) {
        expect(type).toBe('message')
        this.listener = listener
      },
      postMessage: postMessageImpl || jasmine.createSpy('postMessage')
    }
  }

  it('should acknowledge init messages', () => {
    const workerScope = createWorkerScope()

    startCanvasWorker(workerScope)
    workerScope.listener({ data: { action: 'init' } })

    expect(workerScope.postMessage).toHaveBeenCalledWith({
      action: 'initialized',
      version: 'canvas-worker-test-version'
    })
  })

  it('should ignore unknown actions', () => {
    const workerScope = createWorkerScope()

    startCanvasWorker(workerScope)
    workerScope.listener({ data: { action: 'noop' } })

    expect(workerScope.postMessage).not.toHaveBeenCalled()
  })

  it('should close transferred bitmaps when encoding fails', async () => {
    var bitmap = { close: jasmine.createSpy('close') }
    globalThis.OffscreenCanvas = function () {
      return {
        getContext: function () {
          return null
        }
      }
    }
    var workerScope = createWorkerScope()

    startCanvasWorker(workerScope)
    workerScope.listener({
      data: {
        action: 'encode',
        id: 7,
        bitmap: bitmap,
        width: 100,
        height: 50,
        maxSize: 100
      }
    })
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })

    expect(bitmap.close).toHaveBeenCalledTimes(1)
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({
        action: 'errored',
        id: 7
      })
    )
  })

  it('should reuse a completed offscreen canvas for sequential encodes', async () => {
    var clearRect = jasmine.createSpy('clearRect')
    var drawImage = jasmine.createSpy('drawImage')
    var convertToBlob = jasmine
      .createSpy('convertToBlob')
      .and.callFake(function (options) {
        return Promise.resolve({
          type: options.type,
          arrayBuffer: function () {
            return Promise.resolve(new Uint8Array([1, 2, 3]).buffer)
          }
        })
      })
    var createOffscreenCanvas = jasmine
      .createSpy('OffscreenCanvas')
      .and.callFake(function (width, height) {
        return {
          width: width,
          height: height,
          getContext: function () {
            return {
              clearRect: clearRect,
              drawImage: drawImage
            }
          },
          convertToBlob: convertToBlob
        }
      })
    globalThis.OffscreenCanvas = createOffscreenCanvas
    var workerScope = createWorkerScope()

    startCanvasWorker(workerScope)

    for (var id = 1; id <= 2; id += 1) {
      workerScope.listener({
        data: {
          action: 'encode',
          id: id,
          bitmap: { close: jasmine.createSpy('close') },
          width: 100,
          height: 50,
          maxSize: 100,
          mimeType: 'image/webp',
          quality: 0.5
        }
      })
      await new Promise(function (resolve) {
        setTimeout(resolve, 0)
      })
    }

    expect(createOffscreenCanvas).toHaveBeenCalledTimes(1)
    expect(clearRect).toHaveBeenCalledTimes(2)
    expect(clearRect).toHaveBeenCalledWith(0, 0, 100, 50)
    expect(drawImage).toHaveBeenCalledTimes(2)
    expect(convertToBlob).toHaveBeenCalledTimes(2)
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({ action: 'encoded', id: 1 })
    )
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({ action: 'encoded', id: 2 })
    )
  })

  it('should reject a target above the pixel-byte budget before allocating it', async () => {
    var createOffscreenCanvas = jasmine
      .createSpy('OffscreenCanvas')
      .and.callFake(function (width, height) {
        return {
          width: width,
          height: height,
          getContext: function () {
            return {
              clearRect: jasmine.createSpy('clearRect'),
              drawImage: jasmine.createSpy('drawImage')
            }
          },
          convertToBlob: function (options) {
            return Promise.resolve({
              type: options.type,
              arrayBuffer: function () {
                return Promise.resolve(new Uint8Array([1]).buffer)
              }
            })
          }
        }
      })
    globalThis.OffscreenCanvas = createOffscreenCanvas
    var workerScope = createWorkerScope()
    var oversizedBitmap = { close: jasmine.createSpy('close') }
    var oversizedDimension =
      Math.floor(Math.sqrt(MAX_CANVAS_POOL_PIXEL_BYTES / 4)) + 1

    startCanvasWorker(workerScope)
    workerScope.listener({
      data: {
        action: 'encode',
        id: 1,
        bitmap: oversizedBitmap,
        width: oversizedDimension,
        height: oversizedDimension,
        maxSize: oversizedDimension,
        mimeType: 'image/webp'
      }
    })
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })

    expect(createOffscreenCanvas).not.toHaveBeenCalled()
    expect(oversizedBitmap.close).toHaveBeenCalledTimes(1)
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      action: 'errored',
      id: 1,
      error: 'Canvas worker target memory budget exceeded'
    })

    workerScope.listener({
      data: {
        action: 'encode',
        id: 2,
        bitmap: {},
        width: 10,
        height: 10,
        maxSize: 10,
        mimeType: 'image/webp'
      }
    })
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })

    expect(createOffscreenCanvas).toHaveBeenCalledTimes(1)
  })

  it('should drop an oversized blob before reading its ArrayBuffer', async () => {
    var arrayBuffer = jasmine.createSpy('arrayBuffer')
    globalThis.OffscreenCanvas = function (width, height) {
      return {
        width: width,
        height: height,
        getContext: function () {
          return {
            clearRect: jasmine.createSpy('clearRect'),
            drawImage: jasmine.createSpy('drawImage')
          }
        },
        convertToBlob: function () {
          return Promise.resolve({
            size: 11,
            type: 'image/webp',
            arrayBuffer: arrayBuffer
          })
        }
      }
    }
    var workerScope = createWorkerScope()

    startCanvasWorker(workerScope)
    workerScope.listener({
      data: {
        action: 'encode',
        id: 8,
        bitmap: { close: jasmine.createSpy('close') },
        width: 100,
        height: 50,
        maxSize: 100,
        maxEncodedBytes: 10,
        mimeType: 'image/webp'
      }
    })
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })

    expect(arrayBuffer).not.toHaveBeenCalled()
    expect(workerScope.postMessage).toHaveBeenCalledWith({
      action: 'dropped',
      id: 8,
      reason: 'encode_too_large',
      encodedBytesCount: 11,
      width: 100,
      height: 50
    })
  })

  it('should clear transparent pixels before reusing an offscreen canvas', async () => {
    var currentPixel = 0
    var clearRect = jasmine.createSpy('clearRect').and.callFake(function () {
      currentPixel = 0
    })
    var drawImage = jasmine.createSpy('drawImage').and.callFake(function (
      bitmap
    ) {
      if (bitmap.alpha > 0) {
        currentPixel = bitmap.value
      }
    })
    globalThis.OffscreenCanvas = jasmine
      .createSpy('OffscreenCanvas')
      .and.callFake(function (width, height) {
        return {
          width: width,
          height: height,
          getContext: function () {
            return {
              clearRect: clearRect,
              drawImage: drawImage
            }
          },
          convertToBlob: function (options) {
            var encodedPixel = currentPixel
            return Promise.resolve({
              type: options.type,
              arrayBuffer: function () {
                return Promise.resolve(
                  new Uint8Array([encodedPixel]).buffer
                )
              }
            })
          }
        }
      })
    var workerScope = createWorkerScope()
    startCanvasWorker(workerScope)

    workerScope.listener({
      data: {
        action: 'encode',
        id: 1,
        bitmap: { alpha: 1, value: 255 },
        width: 1,
        height: 1,
        maxSize: 1,
        mimeType: 'image/webp'
      }
    })
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
    workerScope.listener({
      data: {
        action: 'encode',
        id: 2,
        bitmap: { alpha: 0, value: 255 },
        width: 1,
        height: 1,
        maxSize: 1,
        mimeType: 'image/webp'
      }
    })
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })

    expect(globalThis.OffscreenCanvas).toHaveBeenCalledTimes(1)
    expect(clearRect).toHaveBeenCalledTimes(2)
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({
        action: 'encoded',
        id: 1,
        dataUrl: 'data:image/webp;base64,/w=='
      })
    )
    expect(workerScope.postMessage).toHaveBeenCalledWith(
      jasmine.objectContaining({
        action: 'encoded',
        id: 2,
        dataUrl: 'data:image/webp;base64,AA=='
      })
    )
  })
})
