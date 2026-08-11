import { createCanvasEncodeWorkerManager } from './canvasEncodeWorker'
import {
  isWebGLReplayCanvas,
  markReplayInternalCanvas
} from './canvasContext'
import { estimateEncodedBytesFromDataUrl } from './canvasSerializeArgs'

var CANVAS_ENCODE_REQUEST_TIMEOUT = 10000
var CANVAS_ENCODE_CALLER_TIMEOUT = CANVAS_ENCODE_REQUEST_TIMEOUT + 1000
var MAX_SHARED_CANVAS_ENCODE_QUEUE = 64
// Native canvas work can outlive a recorder because createImageBitmap() and
// toBlob() cannot be cancelled.  Keep admission at module scope so stopping and
// recreating a bridge cannot reset the physical concurrency watermark.
// `$r*` marks object fields that stay private to this module and may be
// property-mangled in production. Never use it for configuration or payloads.
var sharedCanvasEncodeInFlightCount = 0
var sharedCanvasEncodeQueue = []

function drainSharedCanvasEncodeQueue() {
  while (sharedCanvasEncodeQueue.length) {
    for (
      var cancelledIndex = sharedCanvasEncodeQueue.length - 1;
      cancelledIndex >= 0;
      cancelledIndex -= 1
    ) {
      if (sharedCanvasEncodeQueue[cancelledIndex].$rCancelled) {
        sharedCanvasEncodeQueue.splice(cancelledIndex, 1)
      }
    }
    if (!sharedCanvasEncodeQueue.length) {
      return
    }

    var entryIndex = 0
    var entry = sharedCanvasEncodeQueue[entryIndex]
    if (sharedCanvasEncodeInFlightCount >= entry.$rMaxConcurrency) {
      // Do not let a higher-concurrency bridge bypass the oldest lower-limit
      // entry forever. Pausing admission here lets the shared count drain
      // until the FIFO head becomes eligible.
      return
    }
    entry = sharedCanvasEncodeQueue.splice(entryIndex, 1)[0]
    entry.$rStarted = true
    sharedCanvasEncodeInFlightCount += 1
    var taskResult
    try {
      taskResult = entry.$rTask()
    } catch (error) {
      settleSharedCanvasEncodePhysicalWork(entry)
      finishSharedCanvasEncodeEntry(entry, entry.$rReject, error)
      continue
    }
    observeSharedCanvasEncodeEntry(entry, taskResult)
  }
}

function observeSharedCanvasEncodeEntry(entry, taskResult) {
  Promise.resolve(taskResult).then(
    function (result) {
      settleSharedCanvasEncodePhysicalWork(entry)
      if (entry.$rQuarantined) {
        releaseQuarantinedSharedCanvasEncodeEntry(entry)
        return
      }
      finishSharedCanvasEncodeEntry(entry, entry.$rResolve, result)
    },
    function (error) {
      settleSharedCanvasEncodePhysicalWork(entry)
      if (entry.$rQuarantined) {
        releaseQuarantinedSharedCanvasEncodeEntry(entry)
        return
      }
      finishSharedCanvasEncodeEntry(entry, entry.$rReject, error)
    }
  )
}

function settleSharedCanvasEncodePhysicalWork(entry) {
  if (entry.$rPhysicalSettled) {
    return
  }
  entry.$rPhysicalSettled = true
  entry.$rResolvePhysicalSettled()
}

function releaseQuarantinedSharedCanvasEncodeEntry(entry) {
  if (entry.$rQuarantined) {
    entry.$rQuarantined = false
    sharedCanvasEncodeInFlightCount = Math.max(
      sharedCanvasEncodeInFlightCount - 1,
      0
    )
  }
  drainSharedCanvasEncodeQueue()
}

function quarantineSharedCanvasEncodeEntry(entry, error) {
  if (!entry || !entry.$rStarted || entry.$rSettled) {
    return false
  }
  entry.$rQuarantined = true
  entry.$rSettled = true
  entry.$rReject(error)
  return true
}

function finishSharedCanvasEncodeEntry(entry, settle, value) {
  if (entry.$rSettled) {
    return
  }
  entry.$rSettled = true
  sharedCanvasEncodeInFlightCount = Math.max(
    sharedCanvasEncodeInFlightCount - 1,
    0
  )
  settle(value)
  drainSharedCanvasEncodeQueue()
}

function createSharedCanvasEncodeAdmission(
  maxConcurrency,
  task
) {
  var entry
  var resolvePhysicalSettled
  var physicalSettled = new Promise(function (resolve) {
    resolvePhysicalSettled = resolve
  })
  var promise = new Promise(function (resolve, reject) {
    entry = {
      $rCancelled: false,
      $rMaxConcurrency: maxConcurrency,
      $rPhysicalSettled: false,
      $rQuarantined: false,
      $rReject: reject,
      $rResolve: resolve,
      $rResolvePhysicalSettled: resolvePhysicalSettled,
      $rSettled: false,
      $rStarted: false,
      $rTask: task
    }
    if (sharedCanvasEncodeQueue.length >= MAX_SHARED_CANVAS_ENCODE_QUEUE) {
      entry.$rSettled = true
      settleSharedCanvasEncodePhysicalWork(entry)
      reject(new Error('Canvas shared encode queue full'))
      return
    }
    sharedCanvasEncodeQueue.push(entry)
    drainSharedCanvasEncodeQueue()
  })

  var bridge = {
    $rPromise: promise,
    $rPhysicalSettled: physicalSettled,
    $rCancel: function (error) {
      if (!entry || entry.$rStarted || entry.$rSettled) {
        return false
      }
      entry.$rCancelled = true
      entry.$rSettled = true
      var entryIndex = sharedCanvasEncodeQueue.indexOf(entry)
      if (entryIndex !== -1) {
        sharedCanvasEncodeQueue.splice(entryIndex, 1)
      }
      settleSharedCanvasEncodePhysicalWork(entry)
      entry.$rReject(error)
      drainSharedCanvasEncodeQueue()
      return true
    },
    $rQuarantine: function (error) {
      return quarantineSharedCanvasEncodeEntry(entry, error)
    }
  }
  return bridge
}

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
        : configuration.replayCanvasMaxCanvasSize,
    maxEncodedBytes:
      encodeOptions && typeof encodeOptions.maxEncodedBytes === 'number'
        ? encodeOptions.maxEncodedBytes
        : configuration.replayCanvasMaxEncodedBytes
  }
}

function createEncodeTooLargeResult(encodedBytesCount) {
  return {
    ok: false,
    reason: 'encode_too_large',
    encodedBytesCount: encodedBytesCount
  }
}

function isCanvasEncodeDropResult(result) {
  return !!result && result.ok === false && typeof result.reason === 'string'
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
    targetCanvas = markReplayInternalCanvas(document.createElement('canvas'))
    targetCanvas.width = targetSize.width
    targetCanvas.height = targetSize.height
    var context = targetCanvas.getContext('2d')
    if (!context) {
      throw new Error('Cannot create canvas 2d context for encoding')
    }
    context.drawImage(canvas, 0, 0, targetSize.width, targetSize.height)
  }

  return encodeCanvasElementOnMainThread(
    targetCanvas,
    encodeConfiguration
  ).then(function (encodedResult) {
    if (isCanvasEncodeDropResult(encodedResult)) {
      return encodedResult
    }
    return {
      dataUrl: encodedResult,
      width: targetSize.width,
      height: targetSize.height
    }
  })
}

function encodeCanvasElementOnMainThread(canvas, encodeConfiguration) {
  if (
    typeof canvas.toBlob !== 'function' ||
    typeof FileReader !== 'function'
  ) {
    var dataUrl = canvas.toDataURL(
      encodeConfiguration.mimeType,
      encodeConfiguration.quality
    )
    var encodedBytesCount = estimateEncodedBytesFromDataUrl(dataUrl)
    return Promise.resolve(
      typeof encodeConfiguration.maxEncodedBytes === 'number' &&
        encodedBytesCount > encodeConfiguration.maxEncodedBytes
        ? createEncodeTooLargeResult(encodedBytesCount)
        : dataUrl
    )
  }

  return new Promise(function (resolve, reject) {
    canvas.toBlob(
      function (blob) {
        if (!blob) {
          reject(new Error('Canvas toBlob encoding failed'))
          return
        }
        if (
          typeof encodeConfiguration.maxEncodedBytes === 'number' &&
          blob.size > encodeConfiguration.maxEncodedBytes
        ) {
          resolve(createEncodeTooLargeResult(blob.size))
          return
        }
        var reader
        try {
          reader = new FileReader()
        } catch (error) {
          reject(error)
          return
        }
        reader.onload = function () {
          if (typeof reader.result !== 'string') {
            reject(new Error('Cannot read encoded canvas blob'))
            return
          }
          resolve(reader.result)
        }
        reader.onerror = function () {
          reject(reader.error || new Error('Cannot read encoded canvas blob'))
        }
        try {
          reader.readAsDataURL(blob)
        } catch (error) {
          reject(error)
        }
      },
      encodeConfiguration.mimeType,
      encodeConfiguration.quality
    )
  })
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

function clampInteger(value, fallback, minimum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.max(Math.floor(value), minimum)
}

export function createCanvasEncodeBridge(configuration, options) {
  options = options || {}
  var stopped = false
  var generation = 0
  var inFlightCount = 0
  var nextRequestId = 0
  var now = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.now || Date.now
    : Date.now
  var maxConcurrentEncodes = clampInteger(
    configuration.replayCanvasMaxConcurrentEncodes,
    1,
    1
  )
  var maxQueuedEncodes = Math.max(maxConcurrentEncodes * 20, 50)
  var pendingRequests = {}
  var queuedRequests = []
  var activeJobs = []
  var imageBitmapResizeOptionsSupported
  var workerRuntimeFailureCount = 0
  var workerRetryAt = 0
  var createImageBitmapImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? getOption(options, 'createImageBitmap', globalThis.createImageBitmap)
    : globalThis.createImageBitmap
  var urlObject = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? getOption(options, 'url', globalThis.URL)
    : globalThis.URL
  var workerCtor = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? getOption(options, 'Worker', globalThis.Worker)
    : globalThis.Worker
  var workerEncodingSupported = canUseWorkerEncoding(
    createImageBitmapImpl,
    workerCtor,
    urlObject
  )
  var workerManager = createCanvasEncodeWorkerManager(configuration, {
    createWorker: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? options.createWorker
      : undefined,
    Worker: workerCtor,
    url: urlObject,
    onMessage: function (data) {
      var request = pendingRequests[data.id]
      if (!request) {
        return
      }
      cleanupRequest(data.id)
      if (data.action === 'encoded') {
        workerRuntimeFailureCount = 0
        workerRetryAt = 0
        request.$rResolve({
          dataUrl: data.dataUrl,
          width: data.width,
          height: data.height
        })
      } else if (data.action === 'dropped' && data.reason) {
        workerRuntimeFailureCount = 0
        workerRetryAt = 0
        request.$rResolve({
          ok: false,
          reason: data.reason,
          encodedBytesCount: data.encodedBytesCount
        })
      } else {
        var error = new Error(data.error || 'Canvas encode worker failed')
        recordWorkerRuntimeFailure()
        request.$rReject(error)
      }
    },
    onError: function (error, meta) {
      if (meta && meta.phase === 'initialization') {
        workerEncodingSupported = false
      } else {
        recordWorkerRuntimeFailure()
      }
      workerManager.stop()
      rejectPendingRequests(
        error || new Error('Canvas encode worker failed')
      )
    }
  })

  function cleanupRequest(id) {
    var request = pendingRequests[id]
    if (request && request.$rTimeoutId !== undefined) {
      clearTimeout(request.$rTimeoutId)
      request.$rTimeoutId = undefined
    }
    delete pendingRequests[id]
  }

  function rejectPendingRequests(error) {
    Object.keys(pendingRequests).forEach(function (requestId) {
      var request = pendingRequests[requestId]
      cleanupRequest(requestId)
      request.$rReject(error)
    })
  }

  function recordWorkerRuntimeFailure() {
    workerRuntimeFailureCount += 1
    var baseDelay = Math.max(
      configuration.replayCanvasAutoFailureBackoff || 1000,
      1000
    )
    var retryDelay = Math.min(
      baseDelay * Math.pow(2, Math.min(workerRuntimeFailureCount - 1, 6)),
      60000
    )
    workerRetryAt = now() + retryDelay
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
      if (queuedRequest.$rCancelled) {
        continue
      }
      startEncode(queuedRequest)
    }
  }

  function encodeWithWorker(job, encodeGeneration) {
    var encodeConfiguration = buildEncodeConfiguration(
      configuration,
      job.$rEncodeOptions
    )
    var targetSize = computeTargetSize(
      job.$rCanvas.width,
      job.$rCanvas.height,
      encodeConfiguration.maxSize
    )
    return createImageBitmapForEncoding(job, targetSize).then(function (bitmap) {
      if (stopped || encodeGeneration !== generation) {
        closeBitmap(bitmap)
        throw new Error('Canvas encode bridge stopped')
      }
      var bitmapTransferred = false
      return new Promise(function (resolve, reject) {
        var activeWorker = workerManager.ensureWorker()
        if (!activeWorker) {
          reject(new Error('Canvas encode worker is unavailable'))
          return
        }
        var requestId = nextRequestId
        nextRequestId += 1
      pendingRequests[requestId] = {
          $rResolve: resolve,
          $rReject: reject,
          $rTimeoutId: undefined
        }
        try {
          activeWorker.postMessage(
            {
              action: 'encode',
              id: requestId,
              bitmap: bitmap,
              width: targetSize.width,
              height: targetSize.height,
              mimeType: encodeConfiguration.mimeType,
              quality: encodeConfiguration.quality,
              maxSize: encodeConfiguration.maxSize,
              maxEncodedBytes: encodeConfiguration.maxEncodedBytes
            },
            [bitmap]
          )
          bitmapTransferred = true
          if (pendingRequests[requestId]) {
            pendingRequests[requestId].$rTimeoutId = setTimeout(function () {
              if (!pendingRequests[requestId]) {
                return
              }
              var timeoutError = new Error(
                'Canvas encode worker request timed out'
              )
              recordWorkerRuntimeFailure()
              workerManager.stop()
              rejectPendingRequests(timeoutError)
            }, CANVAS_ENCODE_REQUEST_TIMEOUT)
          }
        } catch (error) {
          cleanupRequest(requestId)
          recordWorkerRuntimeFailure()
          workerManager.stop()
          rejectPendingRequests(error)
          reject(error)
        }
      }).catch(function (error) {
        if (!bitmapTransferred) {
          closeBitmap(bitmap)
        }
        throw error
      })
    })
  }

  function createImageBitmapForEncoding(job, targetSize) {
    var canvas = job.$rCanvas
    var shouldResize =
      targetSize.width !== canvas.width || targetSize.height !== canvas.height
    if (!shouldResize) {
      return Promise.resolve(createImageBitmapImpl(canvas))
    }
    if (imageBitmapResizeOptionsSupported === false) {
      return createBoundedResizedCanvasBitmap(canvas, targetSize)
    }

    var resizedBitmap
    try {
      resizedBitmap = createImageBitmapImpl(canvas, {
        resizeWidth: targetSize.width,
        resizeHeight: targetSize.height,
        resizeQuality: 'high'
      })
    } catch (error) {
      if (!isUnsupportedImageBitmapResizeError(error)) {
        return Promise.reject(error)
      }
      imageBitmapResizeOptionsSupported = false
      return createBoundedResizedCanvasBitmap(canvas, targetSize)
    }

    return Promise.resolve(resizedBitmap).then(
      function (bitmap) {
        var hasUnknownBitmapSize =
          typeof bitmap.width !== 'number' ||
          typeof bitmap.height !== 'number'
        var hasExpectedBitmapSize =
          bitmap.width === targetSize.width &&
          bitmap.height === targetSize.height
        if (hasUnknownBitmapSize || hasExpectedBitmapSize) {
          imageBitmapResizeOptionsSupported = true
          return bitmap
        }

        imageBitmapResizeOptionsSupported = false
        closeBitmap(bitmap)
        return createBoundedResizedCanvasBitmap(canvas, targetSize)
      },
      function (error) {
        if (!isUnsupportedImageBitmapResizeError(error)) {
          throw error
        }
        imageBitmapResizeOptionsSupported = false
        return createBoundedResizedCanvasBitmap(canvas, targetSize)
      }
    )
  }

  function createBoundedResizedCanvasBitmap(canvas, targetSize) {
    var stagingCanvas = markReplayInternalCanvas(
      document.createElement('canvas')
    )
    var bitmapResult
    try {
      // Some browsers expose createImageBitmap(canvas) but not its resize
      // overload. Downsample before creating the bitmap so the fallback never
      // allocates an ImageBitmap at the potentially much larger source size.
      // The target still honors an explicit customer maxSize without adding a
      // hidden 2D-only clamp.
      stagingCanvas.width = targetSize.width
      stagingCanvas.height = targetSize.height
      var stagingContext = stagingCanvas.getContext('2d')
      if (!stagingContext) {
        throw new Error('Cannot create canvas 2d context for resize staging')
      }
      stagingContext.drawImage(
        canvas,
        0,
        0,
        targetSize.width,
        targetSize.height
      )
      bitmapResult = createImageBitmapImpl(stagingCanvas)
    } catch (error) {
      releaseCanvasBackingStore(stagingCanvas)
      return Promise.reject(error)
    }

    return Promise.resolve(bitmapResult).then(
      function (bitmap) {
        releaseCanvasBackingStore(stagingCanvas)
        return bitmap
      },
      function (error) {
        releaseCanvasBackingStore(stagingCanvas)
        throw error
      }
    )
  }

  function releaseCanvasBackingStore(canvas) {
    try {
      canvas.width = 0
      canvas.height = 0
    } catch (_) {}
  }

  function isUnsupportedImageBitmapResizeError(error) {
    return (
      !error ||
      error.name === 'TypeError' ||
      error.name === 'NotSupportedError' ||
      error instanceof TypeError
    )
  }

  function closeBitmap(bitmap) {
    if (bitmap && typeof bitmap.close === 'function') {
      try {
        bitmap.close()
      } catch (_) {}
    }
  }

  function runEncodeJob(job, encodeGeneration) {
    var shouldUseWorker =
      workerEncodingSupported && now() >= workerRetryAt
    if (shouldUseWorker) {
      return encodeWithWorker(job, encodeGeneration).catch(
        function (error) {
          if (
            stopped ||
            job.$rCancelled ||
            encodeGeneration !== generation
          ) {
            throw error
          }
          return encodeCanvasOnMainThread(
            job.$rCanvas,
            configuration,
            job.$rEncodeOptions
          )
        }
      )
    }

    return Promise.resolve().then(function () {
      if (
        stopped ||
        job.$rCancelled ||
        encodeGeneration !== generation
      ) {
        throw new Error('Canvas encode bridge stopped')
      }
      return encodeCanvasOnMainThread(
        job.$rCanvas,
        configuration,
        job.$rEncodeOptions
      )
    })
  }

  function startEncode(job) {
    inFlightCount += 1
    job.$rOccupiesSlot = true
    activeJobs.push(job)
    var encodeGeneration = generation
    job.$rSharedAdmission = createSharedCanvasEncodeAdmission(
      maxConcurrentEncodes,
      function () {
        return runEncodeJob(job, encodeGeneration)
      }
    )
    job.$rSharedAdmission.$rPhysicalSettled.then(function () {
      settleJobPhysicalWork(job)
    })
    job.$rCallerTimeoutId = setTimeout(function () {
      if (job.$rCancelled) {
        return
      }
      var timeoutError = new Error('Canvas encode request timed out')
      job.$rCancelled = true
      if (job.$rSharedAdmission) {
        if (!job.$rSharedAdmission.$rCancel(timeoutError)) {
          job.$rSharedAdmission.$rQuarantine(timeoutError)
        }
      }
      job.$rReject(timeoutError)

      // The native operation itself remains uncancellable. Its admission is
      // quarantined and the shared circuit opens, so a never-settling browser
      // callback cannot block every future recorder while repeated native work
      // is still bounded during the recovery window.
      var activeJobIndex = activeJobs.indexOf(job)
      if (activeJobIndex !== -1) {
        activeJobs.splice(activeJobIndex, 1)
      }
      releaseJobSlot(job)
      runNextQueuedRequest()
    }, CANVAS_ENCODE_CALLER_TIMEOUT)

    job.$rSharedAdmission.$rPromise
      .then(function (result) {
        if (!job.$rCancelled) {
          clearJobCallerTimeout(job)
          job.$rResolve(result)
        }
      })
      .catch(function (error) {
        if (!job.$rCancelled) {
          clearJobCallerTimeout(job)
          job.$rReject(error)
        }
      })
      .finally(function () {
        clearJobCallerTimeout(job)
        job.$rSharedAdmission = undefined
        var activeJobIndex = activeJobs.indexOf(job)
        if (activeJobIndex !== -1) {
          activeJobs.splice(activeJobIndex, 1)
        }
        releaseJobSlot(job)
        runNextQueuedRequest()
      })
  }

  function settleJobPhysicalWork(job) {
    if (job.$rPhysicalSettled) {
      return
    }
    job.$rPhysicalSettled = true
    job.$rResolvePhysicalSettled()
  }

  function clearJobCallerTimeout(job) {
    if (job.$rCallerTimeoutId !== undefined) {
      clearTimeout(job.$rCallerTimeoutId)
      job.$rCallerTimeoutId = undefined
    }
  }

  function releaseJobSlot(job) {
    if (!job.$rOccupiesSlot) {
      return
    }
    job.$rOccupiesSlot = false
    inFlightCount = Math.max(inFlightCount - 1, 0)
  }

  function cancelOutstandingJobs(error) {
    var shouldStopWorker =
      stopped || Object.keys(pendingRequests).length > 0
    queuedRequests.forEach(function (job) {
      job.$rCancelled = true
      clearJobCallerTimeout(job)
      job.$rReject(error)
      settleJobPhysicalWork(job)
    })
    queuedRequests = []

    activeJobs.forEach(function (job) {
      job.$rCancelled = true
      clearJobCallerTimeout(job)
      // Main-thread canvas APIs such as createImageBitmap() and toBlob() cannot
      // be cancelled. Reject the caller immediately. On final stop, quarantine
      // a started task so it cannot permanently occupy the module-level slot;
      // reset keeps the physical admission because this same recorder is still
      // active and can safely wait for it.
      if (job.$rSharedAdmission) {
        var cancelledBeforeStart = job.$rSharedAdmission.$rCancel(error)
        if (!cancelledBeforeStart && stopped) {
          job.$rSharedAdmission.$rQuarantine(error)
        }
      }
      job.$rReject(error)
      // Physical settlement remains tied to the real native promise, which
      // prevents a WebGL staging surface from being reused while the browser
      // may still read it.
      releaseJobSlot(job)
    })
    activeJobs = []

    rejectPendingRequests(error)
    if (shouldStopWorker) {
      workerManager.stop()
    }
  }

  function encodeWithLifecycle(canvas, encodeOptions) {
    var job
    var result = new Promise(function (resolve, reject) {
      job = {
        $rCanvas: canvas,
        $rEncodeOptions: encodeOptions,
        $rResolve: resolve,
        $rReject: reject,
        $rCancelled: false,
        $rOccupiesSlot: false,
        $rSharedAdmission: undefined,
        $rCallerTimeoutId: undefined,
        $rPhysicalSettled: false,
        $rResolvePhysicalSettled: undefined
      }
    })
    var physicalSettled = new Promise(function (resolve) {
      job.$rResolvePhysicalSettled = resolve
    })

    if (stopped) {
      job.$rReject(new Error('Canvas encode bridge stopped'))
      settleJobPhysicalWork(job)
    } else if (queuedRequests.length >= maxQueuedEncodes) {
      job.$rReject(new Error('Canvas encode bridge queue full'))
      settleJobPhysicalWork(job)
    } else {
      queuedRequests.push(job)
      runNextQueuedRequest()
    }

    return {
      result: result,
      physicalSettled: physicalSettled
    }
  }

  var bridge = {
    encode: function (canvas, encodeOptions) {
      if (isWebGLReplayCanvas(canvas)) {
        return Promise.resolve({
          ok: false,
          reason: 'webgl_plugin_missing'
        })
      }
      return encodeWithLifecycle(canvas, encodeOptions).result
    },
    encodeWithLifecycle: encodeWithLifecycle,
    reset: function () {
      generation += 1
      cancelOutstandingJobs(new Error('Canvas encode bridge reset'))
    },
    stop: function () {
      stopped = true
      generation += 1
      cancelOutstandingJobs(new Error('Canvas encode bridge stopped'))
    }
  }
  if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
    bridge.getWorkerStatus = function () {
      return workerManager.getStatus()
    }
  }
  return bridge
}
