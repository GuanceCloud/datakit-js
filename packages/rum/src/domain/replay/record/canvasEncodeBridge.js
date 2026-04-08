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

function encodeCanvasOnMainThread(canvas, configuration) {
  var targetSize = computeTargetSize(
    canvas.width,
    canvas.height,
    configuration.replayCanvasMaxCanvasSize
  )
  var targetCanvas = canvas

  if (targetSize.width !== canvas.width || targetSize.height !== canvas.height) {
    targetCanvas = document.createElement('canvas')
    targetCanvas.width = targetSize.width
    targetCanvas.height = targetSize.height
    var context = targetCanvas.getContext('2d')
    if (!context) {
      throw new Error('Cannot create canvas 2d context for encoding')
    }
    context.drawImage(canvas, 0, 0, targetSize.width, targetSize.height)
  }

  return {
    dataUrl: targetCanvas.toDataURL(
      configuration.replayCanvasMimeType,
      configuration.replayCanvasQuality
    ),
    width: targetSize.width,
    height: targetSize.height
  }
}

function arrayBufferToBase64(buffer) {
  var bytes = new Uint8Array(buffer)
  var chunkSize = 8192
  var result = ''
  for (var i = 0; i < bytes.length; i += chunkSize) {
    var chunk = bytes.subarray(i, i + chunkSize)
    var binary = ''
    for (var j = 0; j < chunk.length; j += 1) {
      binary += String.fromCharCode(chunk[j])
    }
    result += btoa(binary)
  }
  return result
}

function getCanvasEncodeWorkerSource() {
  return `
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
      var result = ''
      for (var i = 0; i < bytes.length; i += chunkSize) {
        var chunk = bytes.subarray(i, i + chunkSize)
        var binary = ''
        for (var j = 0; j < chunk.length; j += 1) {
          binary += String.fromCharCode(chunk[j])
        }
        result += btoa(binary)
      }
      return result
    }
    self.addEventListener('message', function (event) {
      var data = event.data
      if (!data || data.action !== 'encode') {
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
          return canvas.convertToBlob({
            type: data.mimeType,
            quality: data.quality
          }).then(function (blob) {
            return blob.arrayBuffer().then(function (buffer) {
              return {
                id: data.id,
                action: 'encoded',
                dataUrl: 'data:' + data.mimeType + ';base64,' + arrayBufferToBase64(buffer),
                width: targetSize.width,
                height: targetSize.height
              }
            })
          })
        })
        .then(function (response) {
          self.postMessage(response)
        })
        .catch(function (error) {
          self.postMessage({
            id: data.id,
            action: 'errored',
            error: String(error && error.message ? error.message : error)
          })
        })
    })
  `
}

function canUseWorkerEncoding(createImageBitmapImpl, workerCtor, urlObject) {
  return (
    typeof createImageBitmapImpl === 'function' &&
    typeof workerCtor === 'function' &&
    typeof Blob === 'function' &&
    !!urlObject &&
    typeof urlObject.createObjectURL === 'function'
  )
}

function getOption(options, key, fallback) {
  return Object.prototype.hasOwnProperty.call(options, key)
    ? options[key]
    : fallback
}

function createCanvasEncodeWorker(urlObject) {
  return new Worker(
    urlObject.createObjectURL(new Blob([getCanvasEncodeWorkerSource()]))
  )
}

export function createCanvasEncodeBridge(configuration, options) {
  options = options || {}
  var stopped = false
  var inFlightCount = 0
  var nextRequestId = 0
  var maxConcurrentEncodes = configuration.replayCanvasMaxConcurrentEncodes || 1
  var pendingRequests = {}
  var worker
  var workerUrl
  var createImageBitmapImpl = getOption(
    options,
    'createImageBitmap',
    globalThis.createImageBitmap
  )
  var urlObject = getOption(options, 'url', globalThis.URL)
  var workerCtor = getOption(options, 'Worker', globalThis.Worker)
  var workerEncodingEnabled = canUseWorkerEncoding(
    createImageBitmapImpl,
    workerCtor,
    urlObject
  )
  var createWorkerImpl =
    options.createWorker ||
    function () {
      return createCanvasEncodeWorker(urlObject)
    }

  function cleanupRequest(id) {
    delete pendingRequests[id]
  }

  function stopWorker() {
    if (worker) {
      if (typeof worker.terminate === 'function') {
        worker.terminate()
      }
      worker = undefined
    }
    if (workerUrl && urlObject && typeof urlObject.revokeObjectURL === 'function') {
      urlObject.revokeObjectURL(workerUrl)
      workerUrl = undefined
    }
  }

  function ensureWorker() {
    if (!worker && workerEncodingEnabled) {
      worker = createWorkerImpl()
      worker.addEventListener('message', function (event) {
        var data = event.data || {}
        var request = pendingRequests[data.id]
        if (!request) {
          return
        }
        cleanupRequest(data.id)
        if (data.action === 'encoded') {
          request.resolve({
            dataUrl: data.dataUrl,
            width: data.width,
            height: data.height
          })
        } else {
          request.reject(new Error(data.error || 'Canvas encode worker failed'))
        }
      })
      worker.addEventListener('error', function (event) {
        workerEncodingEnabled = false
        stopWorker()
        Object.keys(pendingRequests).forEach(function (requestId) {
          var request = pendingRequests[requestId]
          cleanupRequest(requestId)
          request.reject(event.error || new Error('Canvas encode worker failed'))
        })
      })
    }
    return worker
  }

  function encodeWithWorker(canvas) {
    return Promise.resolve(createImageBitmapImpl(canvas)).then(function (bitmap) {
      return new Promise(function (resolve, reject) {
        var activeWorker = ensureWorker()
        if (!activeWorker) {
          reject(new Error('Canvas encode worker is unavailable'))
          return
        }
        var requestId = nextRequestId
        nextRequestId += 1
        pendingRequests[requestId] = {
          resolve: resolve,
          reject: reject
        }
        activeWorker.postMessage(
          {
            action: 'encode',
            id: requestId,
            bitmap: bitmap,
            width: canvas.width,
            height: canvas.height,
            mimeType: configuration.replayCanvasMimeType,
            quality: configuration.replayCanvasQuality,
            maxSize: configuration.replayCanvasMaxCanvasSize
          },
          [bitmap]
        )
      })
    })
  }

  return {
    encode: function (canvas) {
      return new Promise(function (resolve, reject) {
        if (stopped) {
          reject(new Error('Canvas encode bridge stopped'))
          return
        }
        if (inFlightCount >= maxConcurrentEncodes) {
          reject(new Error('Canvas encode bridge busy'))
          return
        }
        inFlightCount += 1

        var encodePromise = workerEncodingEnabled
          ? encodeWithWorker(canvas).catch(function () {
              workerEncodingEnabled = false
              stopWorker()
              return encodeCanvasOnMainThread(canvas, configuration)
            })
          : Promise.resolve().then(function () {
              return encodeCanvasOnMainThread(canvas, configuration)
            })

        encodePromise.then(resolve, reject).finally(function () {
          inFlightCount -= 1
        })
      })
    },
    stop: function () {
      stopped = true
      Object.keys(pendingRequests).forEach(function (requestId) {
        var request = pendingRequests[requestId]
        cleanupRequest(requestId)
        request.reject(new Error('Canvas encode bridge stopped'))
      })
      stopWorker()
    }
  }
}
