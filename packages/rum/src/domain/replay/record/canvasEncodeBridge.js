import { createCanvasEncodeWorkerManager } from './canvasEncodeWorker'

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

function buildEncodeConfiguration(configuration, encodeOptions) {
  return {
    mimeType: (encodeOptions && encodeOptions.mimeType) || configuration.replayCanvasMimeType,
    quality:
      encodeOptions && typeof encodeOptions.quality === 'number'
        ? encodeOptions.quality
        : configuration.replayCanvasQuality,
    maxSize:
      encodeOptions && typeof encodeOptions.maxSize === 'number'
        ? encodeOptions.maxSize
        : configuration.replayCanvasMaxCanvasSize
  }
}

function encodeCanvasOnMainThread(canvas, configuration, encodeOptions) {
  var encodeConfiguration = buildEncodeConfiguration(configuration, encodeOptions)
  var targetSize = computeTargetSize(
    canvas.width,
    canvas.height,
    encodeConfiguration.maxSize
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
      encodeConfiguration.mimeType,
      encodeConfiguration.quality
    ),
    width: targetSize.width,
    height: targetSize.height
  }
}

export function arrayBufferToBase64(buffer) {
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

export function createCanvasEncodeBridge(configuration, options) {
  options = options || {}
  var stopped = false
  var inFlightCount = 0
  var nextRequestId = 0
  var maxConcurrentEncodes = configuration.replayCanvasMaxConcurrentEncodes || 1
  var maxQueuedEncodes = Math.max(maxConcurrentEncodes * 20, 50)
  var pendingRequests = {}
  var queuedRequests = []
  var activeJobs = []
  var createImageBitmapImpl = getOption(
    options,
    'createImageBitmap',
    globalThis.createImageBitmap
  )
  var urlObject = getOption(options, 'url', globalThis.URL)
  var workerCtor = getOption(options, 'Worker', globalThis.Worker)
  var workerEncodingSupported = canUseWorkerEncoding(
    createImageBitmapImpl,
    workerCtor,
    urlObject
  )
  var workerManager = createCanvasEncodeWorkerManager(configuration, {
    createWorker: options.createWorker,
    Worker: workerCtor,
    url: urlObject,
    onMessage: function (data) {
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
    },
    onError: function (error, meta) {
      if (meta && meta.phase === 'initialization') {
        workerEncodingSupported = false
      }
      workerManager.stop()
      Object.keys(pendingRequests).forEach(function (requestId) {
        var request = pendingRequests[requestId]
        cleanupRequest(requestId)
        request.reject(error || new Error('Canvas encode worker failed'))
      })
    }
  })

  function cleanupRequest(id) {
    delete pendingRequests[id]
  }

  function runNextQueuedRequest() {
    if (stopped) {
      return
    }
    while (
      inFlightCount < maxConcurrentEncodes &&
      queuedRequests.length > 0
    ) {
      var queuedRequest = queuedRequests.shift()
      if (queuedRequest.cancelled) {
        continue
      }
      startEncode(queuedRequest)
    }
  }

  function encodeWithWorker(canvas, encodeOptions) {
    var encodeConfiguration = buildEncodeConfiguration(configuration, encodeOptions)
    return Promise.resolve(createImageBitmapImpl(canvas)).then(function (bitmap) {
      return new Promise(function (resolve, reject) {
        var activeWorker = workerManager.ensureWorker()
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
            mimeType: encodeConfiguration.mimeType,
            quality: encodeConfiguration.quality,
            maxSize: encodeConfiguration.maxSize
          },
          [bitmap]
        )
      }).catch(function (error) {
        closeBitmap(bitmap)
        throw error
      })
    })
  }

  function closeBitmap(bitmap) {
    if (bitmap && typeof bitmap.close === 'function') {
      try {
        bitmap.close()
      } catch (_) {}
    }
  }

  function startEncode(job) {
    inFlightCount += 1
    activeJobs.push(job)

    var shouldUseWorker = workerEncodingSupported

    var encodePromise = shouldUseWorker
      ? encodeWithWorker(job.canvas, job.encodeOptions).catch(function () {
          workerManager.stop()
          return encodeCanvasOnMainThread(
            job.canvas,
            configuration,
            job.encodeOptions
          )
        })
      : Promise.resolve().then(function () {
          return encodeCanvasOnMainThread(
            job.canvas,
            configuration,
            job.encodeOptions
          )
        })

    encodePromise
      .then(function (result) {
        if (!job.cancelled) {
          job.resolve(result)
        }
      })
      .catch(function (error) {
        if (!job.cancelled) {
          job.reject(error)
        }
      })
      .finally(function () {
        var activeJobIndex = activeJobs.indexOf(job)
        if (activeJobIndex !== -1) {
          activeJobs.splice(activeJobIndex, 1)
        }
        inFlightCount -= 1
        runNextQueuedRequest()
      })
  }

  return {
    encode: function (canvas, encodeOptions) {
      return new Promise(function (resolve, reject) {
        if (stopped) {
          reject(new Error('Canvas encode bridge stopped'))
          return
        }
        if (queuedRequests.length >= maxQueuedEncodes) {
          reject(new Error('Canvas encode bridge queue full'))
          return
        }
        var job = {
          canvas: canvas,
          encodeOptions: encodeOptions,
          resolve: resolve,
          reject: reject,
          cancelled: false
        }
        queuedRequests.push(job)
        runNextQueuedRequest()
      })
    },
    stop: function () {
      stopped = true
      queuedRequests.forEach(function (job) {
        job.cancelled = true
        job.reject(new Error('Canvas encode bridge stopped'))
      })
      queuedRequests = []
      activeJobs.forEach(function (job) {
        job.cancelled = true
        job.reject(new Error('Canvas encode bridge stopped'))
      })
      activeJobs = []
      Object.keys(pendingRequests).forEach(function (requestId) {
        var request = pendingRequests[requestId]
        cleanupRequest(requestId)
        request.reject(new Error('Canvas encode bridge stopped'))
      })
      workerManager.stop()
    },
    getWorkerStatus: function () {
      return workerManager.getStatus()
    }
  }
}
