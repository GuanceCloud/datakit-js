function computeTargetSize(width, height, maxSize) {
  if (!width || !height || !maxSize) {
    return { width: width, height: height }
  }
  if (width <= maxSize && height <= maxSize) {
    return { width: width, height: height }
  }
  var ratio = width > height ? maxSize / width : maxSize / height
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio))
  }
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer)
  var chunkSize = 8192
  var binaryChunks = []
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize)
    var binary = ''
    for (var j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j])
    }
    binaryChunks.push(binary)
  }
  return btoa(binaryChunks.join(''))
}

function sendResponse(workerScope, response) {
  try {
    workerScope.postMessage(response)
  } catch (error) {
    workerScope.postMessage({
      action: 'errored',
      id: response && response.id,
      error: String(error && error.message ? error.message : error)
    })
  }
}

function closeBitmap(bitmap) {
  if (bitmap && typeof bitmap.close === 'function') {
    try {
      bitmap.close()
    } catch (_) {}
  }
}

function drawBitmapOnClearedCanvas(context, bitmap, width, height) {
  var canRestoreContextState =
    typeof context.save === 'function' && typeof context.restore === 'function'

  if (canRestoreContextState) {
    context.save()
  }
  try {
    if (typeof context.resetTransform === 'function') {
      context.resetTransform()
    } else if (typeof context.setTransform === 'function') {
      context.setTransform(1, 0, 0, 1, 0, 0)
    }
    context.clearRect(0, 0, width, height)
    context.drawImage(bitmap, 0, 0, width, height)
  } finally {
    if (canRestoreContextState) {
      context.restore()
    }
  }
}

export var MAX_CANVAS_POOL_PIXEL_BYTES = 16 * 1024 * 1024
var CANVAS_POOL_BYTES_PER_PIXEL = 4

function getCanvasPixelBytes(canvas) {
  var width = Number(canvas && canvas.width)
  var height = Number(canvas && canvas.height)
  if (
    !isFinite(width) ||
    !isFinite(height) ||
    width < 0 ||
    height < 0
  ) {
    return Infinity
  }
  var pixelBytes = width * height * CANVAS_POOL_BYTES_PER_PIXEL
  return isFinite(pixelBytes) ? pixelBytes : Infinity
}

function releaseCanvasBackingStore(canvas) {
  if (!canvas) {
    return
  }
  try {
    canvas.width = 0
    canvas.height = 0
  } catch (_) {}
}

export function startCanvasWorker(workerScope) {
  if (workerScope === undefined) {
    workerScope = self
  }
  var canvasPool = []
  var maxCanvasPoolSize = 4
  var pooledCanvasPixelBytes = 0

  function acquireCanvas(width, height) {
    var canvas = canvasPool.pop()
    if (canvas) {
      pooledCanvasPixelBytes = Math.max(
        0,
        pooledCanvasPixelBytes - getCanvasPixelBytes(canvas)
      )
    } else {
      canvas = new OffscreenCanvas(width, height)
    }
    if (canvas.width !== width) {
      canvas.width = width
    }
    if (canvas.height !== height) {
      canvas.height = height
    }
    return canvas
  }

  function releaseCanvas(canvas) {
    var canvasPixelBytes = getCanvasPixelBytes(canvas)
    if (
      canvasPool.length >= maxCanvasPoolSize ||
      !canvasPixelBytes ||
      canvasPixelBytes > MAX_CANVAS_POOL_PIXEL_BYTES ||
      pooledCanvasPixelBytes >
        MAX_CANVAS_POOL_PIXEL_BYTES - canvasPixelBytes
    ) {
      releaseCanvasBackingStore(canvas)
      return
    }
    canvasPool.push(canvas)
    pooledCanvasPixelBytes += canvasPixelBytes
  }

  workerScope.addEventListener('message', function (event) {
    var data = event.data
    if (!data) {
      return
    }
    if (data.action === 'init') {
      sendResponse(workerScope, {
        action: 'initialized',
        version: __BUILD_ENV__SDK_VERSION__
      })
      return
    }
    if (data.action !== 'encode') {
      return
    }

    var canvas
    var canReuseCanvas = false
    Promise.resolve()
      .then(function () {
        var targetSize = computeTargetSize(data.width, data.height, data.maxSize)
        if (getCanvasPixelBytes(targetSize) > MAX_CANVAS_POOL_PIXEL_BYTES) {
          throw new Error('Canvas worker target memory budget exceeded')
        }
        canvas = acquireCanvas(targetSize.width, targetSize.height)
        var context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Cannot create offscreen canvas 2d context for encoding')
        }
        drawBitmapOnClearedCanvas(
          context,
          data.bitmap,
          targetSize.width,
          targetSize.height
        )
        if (typeof canvas.convertToBlob !== 'function') {
          throw new Error('OffscreenCanvas convertToBlob is not supported')
        }
        return canvas
          .convertToBlob({
            type: data.mimeType,
            quality: data.quality
          })
          .then(function (blob) {
            if (
              typeof data.maxEncodedBytes === 'number' &&
              blob.size > data.maxEncodedBytes
            ) {
              return {
                action: 'dropped',
                id: data.id,
                reason: 'encode_too_large',
                encodedBytesCount: blob.size,
                width: targetSize.width,
                height: targetSize.height
              }
            }
            return blob.arrayBuffer().then(function (buffer) {
              var actualMimeType = blob.type || data.mimeType
              return {
                action: 'encoded',
                id: data.id,
                dataUrl:
                  'data:' + actualMimeType + ';base64,' + arrayBufferToBase64(buffer),
                width: targetSize.width,
                height: targetSize.height
              }
            })
          })
          .then(function (response) {
            canReuseCanvas = true
            return response
          })
      })
      .finally(function () {
        closeBitmap(data.bitmap)
        if (canReuseCanvas) {
          releaseCanvas(canvas)
        }
      })
      .then(function (response) {
        sendResponse(workerScope, response)
      })
      .catch(function (error) {
        sendResponse(workerScope, {
          action: 'errored',
          id: data.id,
          error: String(error && error.message ? error.message : error)
        })
      })
  })
}
