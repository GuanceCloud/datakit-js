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

export function startCanvasWorker(workerScope) {
  if (workerScope === undefined) {
    workerScope = self
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

    Promise.resolve()
      .then(function () {
        var targetSize = computeTargetSize(data.width, data.height, data.maxSize)
        var canvas = new OffscreenCanvas(targetSize.width, targetSize.height)
        var context = canvas.getContext('2d')
        if (!context) {
          throw new Error('Cannot create offscreen canvas 2d context for encoding')
        }
        context.drawImage(data.bitmap, 0, 0, targetSize.width, targetSize.height)
        if (data.bitmap && typeof data.bitmap.close === 'function') {
          data.bitmap.close()
        }
        if (typeof canvas.convertToBlob !== 'function') {
          throw new Error('OffscreenCanvas convertToBlob is not supported')
        }
        return canvas
          .convertToBlob({
            type: data.mimeType,
            quality: data.quality
          })
          .then(function (blob) {
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
