import { createCanvasEncodeWorkerManager } from './canvasEncodeWorker'
import {
  getReplayCanvasContextType,
  isWebGLReplayCanvas,
  markReplayInternalCanvas
} from './canvasContext'

var CANVAS_ENCODE_REQUEST_TIMEOUT = 10000
var CANVAS_ENCODE_CALLER_TIMEOUT = CANVAS_ENCODE_REQUEST_TIMEOUT + 1000
var MAX_WEBGL_READBACK_PIXELS = 3840 * 2160
var MAX_WEBGL_READBACK_CAPTURE_BYTES = 16 * 1024 * 1024
var MAX_WEBGL_READBACK_CACHE_BYTES = 16 * 1024 * 1024
var MAX_WEBGL_STAGING_CANVAS_BYTES = 16 * 1024 * 1024
var MAX_CANVAS_ENCODE_TARGET_BYTES = 16 * 1024 * 1024
var MAX_CANVAS_ENCODE_CONCURRENCY = 4
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
    var entry = sharedCanvasEncodeQueue[0]
    if (entry.$rCancelled) {
      sharedCanvasEncodeQueue.shift()
      continue
    }
    if (
      sharedCanvasEncodeInFlightCount >=
      Math.min(entry.$rMaxConcurrency, MAX_CANVAS_ENCODE_CONCURRENCY)
    ) {
      return
    }

    sharedCanvasEncodeQueue.shift()
    entry.$rStarted = true
    sharedCanvasEncodeInFlightCount += 1
    var taskResult
    try {
      taskResult = entry.$rTask()
    } catch (error) {
      finishSharedCanvasEncodeEntry(entry, entry.$rReject, error)
      continue
    }
    observeSharedCanvasEncodeEntry(entry, taskResult)
  }
}

function observeSharedCanvasEncodeEntry(entry, taskResult) {
  Promise.resolve(taskResult).then(
    function (result) {
      finishSharedCanvasEncodeEntry(entry, entry.$rResolve, result)
    },
    function (error) {
      finishSharedCanvasEncodeEntry(entry, entry.$rReject, error)
    }
  )
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

function createSharedCanvasEncodeAdmission(maxConcurrency, task) {
  var entry
  var promise = new Promise(function (resolve, reject) {
    entry = {
      $rCancelled: false,
      $rMaxConcurrency: maxConcurrency,
      $rReject: reject,
      $rResolve: resolve,
      $rSettled: false,
      $rStarted: false,
      $rTask: task
    }
    if (sharedCanvasEncodeQueue.length >= MAX_SHARED_CANVAS_ENCODE_QUEUE) {
      entry.$rSettled = true
      reject(new Error('Canvas shared encode queue full'))
      return
    }
    sharedCanvasEncodeQueue.push(entry)
    drainSharedCanvasEncodeQueue()
  })

  return {
    $rPromise: promise,
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
      entry.$rReject(error)
      drainSharedCanvasEncodeQueue()
      return true
    }
  }
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

function getCanvasEncodeTargetBytes(targetSize) {
  var width = Number(targetSize && targetSize.width)
  var height = Number(targetSize && targetSize.height)
  if (
    !isFinite(width) ||
    !isFinite(height) ||
    width < 0 ||
    height < 0
  ) {
    return Infinity
  }
  var pixelBytes = width * height * 4
  return isFinite(pixelBytes) ? pixelBytes : Infinity
}

function assertCanvasEncodeTargetWithinBudget(targetSize) {
  if (
    getCanvasEncodeTargetBytes(targetSize) >
    MAX_CANVAS_ENCODE_TARGET_BYTES
  ) {
    var memoryBudgetError = new Error(
      'Canvas encode bridge target memory budget exceeded'
    )
    memoryBudgetError.$rDoNotFallbackToMainThread = true
    throw memoryBudgetError
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
  assertCanvasEncodeTargetWithinBudget(targetSize)
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
    return Promise.resolve(
      canvas.toDataURL(
        encodeConfiguration.mimeType,
        encodeConfiguration.quality
      )
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

function clampInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), minimum), maximum)
}

export function createCanvasEncodeBridge(configuration, options) {
  options = options || {}
  var stopped = false
  var generation = 0
  var inFlightCount = 0
  var nextRequestId = 0
  var now = options.now || Date.now
  var maxConcurrentEncodes = clampInteger(
    configuration.replayCanvasMaxConcurrentEncodes,
    1,
    1,
    MAX_CANVAS_ENCODE_CONCURRENCY
  )
  var maxQueuedEncodes = Math.max(maxConcurrentEncodes * 20, 50)
  var maxStagedWebGLFrames = maxConcurrentEncodes * 2
  var stagedWebGLFrameCount = 0
  var pendingRequests = {}
  var queuedRequests = []
  var activeJobs = []
  var availableWebGLStagingCanvases = []
  var webGLStagingCanvasBytes = new WeakMap()
  var webGLStagingCanvasAllocatedBytes = 0
  var webGLReadbackStateByStagingCanvas = new WeakMap()
  var webGLReadbackCachedBytes = 0
  var imageBitmapResizeOptionsSupported
  var workerRuntimeFailureCount = 0
  var workerRetryAt = 0
  var createWebGLReadbackState =
    options.createWebGLReadbackState ||
    function (
      sourceWidth,
      sourceHeight,
      targetWidth,
      targetHeight,
      bytesCount
    ) {
      return {
        sourceWidth: sourceWidth,
        sourceHeight: sourceHeight,
        targetWidth: targetWidth,
        targetHeight: targetHeight,
        sourcePixels: new Uint8Array(sourceWidth * sourceHeight * 4),
        targetPixels: new Uint8ClampedArray(
          targetWidth * targetHeight * 4
        ),
        sourceXOffsets: createWebGLSourceXOffsets(
          sourceWidth,
          targetWidth
        ),
        bytesCount: bytesCount
      }
    }
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
    var encodeConfiguration = job.$rWebGLFrame
      ? job.$rWebGLFrame.$rEncodeConfiguration
      : buildEncodeConfiguration(configuration, job.$rEncodeOptions)
    var targetSize = job.$rWebGLFrame
      ? job.$rWebGLFrame.$rTargetSize
      : computeTargetSize(
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
    try {
      assertCanvasEncodeTargetWithinBudget(targetSize)
    } catch (error) {
      return Promise.reject(error)
    }

    if (job.$rWebGLFrame) {
      return createStagedWebGLFrameBitmap(job)
    }

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
    var stagingCanvas =
      availableWebGLStagingCanvases.pop() ||
      markReplayInternalCanvas(document.createElement('canvas'))
    var bitmapResult

    try {
      // Some browsers expose createImageBitmap(canvas) but not its resize
      // overload. Downsample into the same bounded staging pool used by WebGL
      // instead of creating a full-size ImageBitmap for a large source canvas.
      resizeWebGLStagingCanvas(stagingCanvas, targetSize)
      var stagingContext = stagingCanvas.getContext('2d')
      if (!stagingContext) {
        throw new Error('Cannot create canvas 2d context for resize staging')
      }
      stagingContext.clearRect(0, 0, targetSize.width, targetSize.height)
      stagingContext.drawImage(
        canvas,
        0,
        0,
        targetSize.width,
        targetSize.height
      )
      bitmapResult = createImageBitmapImpl(stagingCanvas)
    } catch (error) {
      discardWebGLStagingCanvas(stagingCanvas)
      return Promise.reject(error)
    }

    return Promise.resolve(bitmapResult).then(
      function (bitmap) {
        releaseWebGLStagingCanvas(stagingCanvas)
        return bitmap
      },
      function (error) {
        discardWebGLStagingCanvas(stagingCanvas)
        throw error
      }
    )
  }

  function createStagedWebGLFrameBitmap(job) {
    var stagingCanvas = job.$rWebGLFrame.$rCanvas
    var bitmapResult
    try {
      bitmapResult = createImageBitmapImpl(stagingCanvas)
    } catch (error) {
      releaseCapturedWebGLFrame(job)
      return Promise.reject(error)
    }

    return Promise.resolve(bitmapResult).then(
      function (bitmap) {
        releaseCapturedWebGLFrame(job)
        return bitmap
      },
      function (error) {
        releaseCapturedWebGLFrame(job)
        throw error
      }
    )
  }

  function captureWebGLFrame(canvas, encodeOptions) {
    var encodeConfiguration = buildEncodeConfiguration(
      configuration,
      encodeOptions
    )
    var targetSize = computeTargetSize(
      canvas.width,
      canvas.height,
      encodeConfiguration.maxSize
    )
    var webGLFrame = {
      $rCanvas: prepareWebGLStagingCanvas(canvas, targetSize),
      $rEncodeConfiguration: encodeConfiguration,
      $rTargetSize: targetSize,
      $rCounted: true
    }
    stagedWebGLFrameCount += 1
    return webGLFrame
  }

  function releaseCapturedWebGLFrame(job) {
    if (!job.$rWebGLFrame) {
      return
    }
    if (job.$rWebGLFrame.$rCounted) {
      job.$rWebGLFrame.$rCounted = false
      stagedWebGLFrameCount = Math.max(stagedWebGLFrameCount - 1, 0)
    }
    if (job.$rWebGLFrame.$rCanvas) {
      var stagingCanvas = job.$rWebGLFrame.$rCanvas
      job.$rWebGLFrame.$rCanvas = undefined
      releaseWebGLStagingCanvas(stagingCanvas)
    }
  }

  function prepareWebGLStagingCanvas(canvas, targetSize) {
    var stagingCanvas =
      availableWebGLStagingCanvases.pop() ||
      markReplayInternalCanvas(document.createElement('canvas'))

    try {
      resizeWebGLStagingCanvas(stagingCanvas, targetSize)
      var stagingContext = stagingCanvas.getContext('2d')
      if (!stagingContext) {
        throw new Error('Cannot create canvas 2d context for WebGL staging')
      }
      validateWebGLContextForCapture(canvas)
      stagingContext.clearRect(0, 0, targetSize.width, targetSize.height)
      if (!copyWebGLFrameIntoStagingCanvas(canvas, stagingContext, targetSize)) {
        if (
          !readWebGLFrameIntoStagingCanvas(
            canvas,
            stagingCanvas,
            stagingContext,
            targetSize
          )
        ) {
          throw new Error('Cannot copy WebGL canvas for replay encoding')
        }
      }
      return stagingCanvas
    } catch (error) {
      discardWebGLStagingCanvas(stagingCanvas)
      throw error
    }
  }

  function getWebGLStagingCanvasBytes(targetSize) {
    var pixelCount = targetSize.width * targetSize.height
    if (
      !isFinite(pixelCount) ||
      pixelCount <= 0 ||
      pixelCount >
        MAX_WEBGL_STAGING_CANVAS_BYTES / 4
    ) {
      return Infinity
    }
    return pixelCount * 4
  }

  function resizeWebGLStagingCanvas(stagingCanvas, targetSize) {
    var previousBytes =
      webGLStagingCanvasBytes.get(stagingCanvas) || 0
    var nextBytes = getWebGLStagingCanvasBytes(targetSize)
    if (
      nextBytes >
      MAX_WEBGL_STAGING_CANVAS_BYTES -
        (webGLStagingCanvasAllocatedBytes - previousBytes)
    ) {
      var memoryBudgetError = new Error(
        'Canvas encode bridge WebGL staging memory budget exceeded'
      )
      memoryBudgetError.$rDoNotFallbackToMainThread = true
      throw memoryBudgetError
    }

    if (
      stagingCanvas.width !== targetSize.width ||
      stagingCanvas.height !== targetSize.height
    ) {
      releaseWebGLReadbackState(stagingCanvas)
      stagingCanvas.width = targetSize.width
      stagingCanvas.height = targetSize.height
    }
    webGLStagingCanvasAllocatedBytes =
      webGLStagingCanvasAllocatedBytes - previousBytes + nextBytes
    webGLStagingCanvasBytes.set(stagingCanvas, nextBytes)
  }

  function validateWebGLContextForCapture(canvas) {
    var webGLContext = canvas.getContext(getReplayCanvasContextType(canvas))
    if (
      !webGLContext ||
      typeof webGLContext.readPixels !== 'function'
    ) {
      return
    }
    if (
      typeof webGLContext.isContextLost === 'function' &&
      webGLContext.isContextLost()
    ) {
      throw new Error('WebGL context is lost')
    }
    if (
      !webGLContext.drawingBufferWidth ||
      !webGLContext.drawingBufferHeight
    ) {
      throw new Error('WebGL drawing buffer is empty')
    }
  }

  function copyWebGLFrameIntoStagingCanvas(
    canvas,
    stagingContext,
    targetSize
  ) {
    try {
      // WebGL snapshot scheduling runs synchronously at the end of the draw
      // task/rAF callback. Copying the backing store at that boundary preserves
      // preserveDrawingBuffer=false frames while avoiding a synchronous
      // GPU-to-CPU readPixels round trip.
      stagingContext.drawImage(
        canvas,
        0,
        0,
        targetSize.width,
        targetSize.height
      )
      return true
    } catch (_) {
      return false
    }
  }

  function encodeStagedWebGLFrameOnMainThread(job) {
    var webGLFrame = job.$rWebGLFrame
    var stagingCanvas = webGLFrame.$rCanvas
    return encodeCanvasElementOnMainThread(
      stagingCanvas,
      webGLFrame.$rEncodeConfiguration
    ).then(function (encodedResult) {
      if (isCanvasEncodeDropResult(encodedResult)) {
        return encodedResult
      }
      return {
        dataUrl: encodedResult,
        width: webGLFrame.$rTargetSize.width,
        height: webGLFrame.$rTargetSize.height
      }
    }).finally(function () {
      releaseCapturedWebGLFrame(job)
    })
  }

  function readWebGLFrameIntoStagingCanvas(
    canvas,
    stagingCanvas,
    stagingContext,
    targetSize
  ) {
    var webGLContextType = getReplayCanvasContextType(canvas)
    var webGLContext = canvas.getContext(webGLContextType)
    if (
      !webGLContext ||
      typeof webGLContext.readPixels !== 'function' ||
      typeof ImageData !== 'function'
    ) {
      return false
    }

    if (
      typeof webGLContext.isContextLost === 'function' &&
      webGLContext.isContextLost()
    ) {
      throw new Error('WebGL context is lost')
    }

    var sourceWidth = webGLContext.drawingBufferWidth
    var sourceHeight = webGLContext.drawingBufferHeight
    if (
      !sourceWidth ||
      !sourceHeight ||
      sourceWidth * sourceHeight > MAX_WEBGL_READBACK_PIXELS
    ) {
      throw new Error('WebGL canvas exceeds the replay readback pixel limit')
    }

    var requiredReadbackBytes =
      sourceWidth * sourceHeight * 4 +
      targetSize.width * targetSize.height * 4 +
      targetSize.width * 4
    if (
      !isFinite(requiredReadbackBytes) ||
      requiredReadbackBytes > MAX_WEBGL_READBACK_CAPTURE_BYTES
    ) {
      throw new Error(
        'WebGL replay readback exceeds the peak memory limit'
      )
    }

    var readbackState = webGLReadbackStateByStagingCanvas.get(stagingCanvas)
    if (
      !readbackState ||
      readbackState.sourceWidth !== sourceWidth ||
      readbackState.sourceHeight !== sourceHeight ||
      readbackState.targetWidth !== targetSize.width ||
      readbackState.targetHeight !== targetSize.height
    ) {
      releaseWebGLReadbackState(stagingCanvas)
      readbackState = createWebGLReadbackState(
        sourceWidth,
        sourceHeight,
        targetSize.width,
        targetSize.height,
        requiredReadbackBytes
      )
      if (
        readbackState.bytesCount <=
        MAX_WEBGL_READBACK_CACHE_BYTES - webGLReadbackCachedBytes
      ) {
        readbackState.cached = true
        webGLReadbackCachedBytes += readbackState.bytesCount
        webGLReadbackStateByStagingCanvas.set(
          stagingCanvas,
          readbackState
        )
      }
    }

    readDefaultWebGLFramebuffer(
      webGLContext,
      readbackState.sourcePixels,
      sourceWidth,
      sourceHeight
    )
    if (
      typeof webGLContext.isContextLost === 'function' &&
      webGLContext.isContextLost()
    ) {
      throw new Error('WebGL context was lost during replay readback')
    }
    downsampleAndFlipWebGLPixels(readbackState)
    stagingContext.putImageData(
      new ImageData(
        readbackState.targetPixels,
        targetSize.width,
        targetSize.height
      ),
      0,
      0
    )
    return true
  }

  function createWebGLSourceXOffsets(sourceWidth, targetWidth) {
    var offsets = new Uint32Array(targetWidth)
    for (var targetX = 0; targetX < targetWidth; targetX += 1) {
      offsets[targetX] =
        Math.min(
          sourceWidth - 1,
          Math.floor(((targetX + 0.5) * sourceWidth) / targetWidth)
        ) * 4
    }
    return offsets
  }

  function readDefaultWebGLFramebuffer(
    webGLContext,
    sourcePixels,
    sourceWidth,
    sourceHeight
  ) {
    var usesSeparateReadFramebuffer =
      webGLContext.READ_FRAMEBUFFER !== undefined &&
      webGLContext.READ_FRAMEBUFFER_BINDING !== undefined
    var framebufferTarget = usesSeparateReadFramebuffer
      ? webGLContext.READ_FRAMEBUFFER
      : webGLContext.FRAMEBUFFER
    var framebufferBinding = usesSeparateReadFramebuffer
      ? webGLContext.READ_FRAMEBUFFER_BINDING
      : webGLContext.FRAMEBUFFER_BINDING
    var previousFramebuffer
    var framebufferChanged = false
    var pixelPackBufferTarget = webGLContext.PIXEL_PACK_BUFFER
    var pixelPackBufferBinding = webGLContext.PIXEL_PACK_BUFFER_BINDING
    var previousPixelPackBuffer
    var pixelPackBufferChanged = false
    var changedPixelStoreParameters = []

    function normalizePixelStore(parameter, value) {
      if (
        parameter === undefined ||
        typeof webGLContext.getParameter !== 'function' ||
        typeof webGLContext.pixelStorei !== 'function'
      ) {
        return
      }
      var previousValue = webGLContext.getParameter(parameter)
      webGLContext.pixelStorei(parameter, value)
      changedPixelStoreParameters.push({
        $rParameter: parameter,
        $rPreviousValue: previousValue
      })
    }

    try {
      if (
        typeof webGLContext.getParameter === 'function' &&
        typeof webGLContext.bindFramebuffer === 'function'
      ) {
        previousFramebuffer = webGLContext.getParameter(framebufferBinding)
        webGLContext.bindFramebuffer(framebufferTarget, null)
        framebufferChanged = true
      }
      if (
        pixelPackBufferTarget !== undefined &&
        pixelPackBufferBinding !== undefined &&
        typeof webGLContext.getParameter === 'function' &&
        typeof webGLContext.bindBuffer === 'function'
      ) {
        previousPixelPackBuffer = webGLContext.getParameter(
          pixelPackBufferBinding
        )
        webGLContext.bindBuffer(pixelPackBufferTarget, null)
        pixelPackBufferChanged = true
      }
      normalizePixelStore(webGLContext.PACK_ALIGNMENT, 1)
      normalizePixelStore(webGLContext.PACK_ROW_LENGTH, 0)
      normalizePixelStore(webGLContext.PACK_SKIP_ROWS, 0)
      normalizePixelStore(webGLContext.PACK_SKIP_PIXELS, 0)
      webGLContext.readPixels(
        0,
        0,
        sourceWidth,
        sourceHeight,
        webGLContext.RGBA,
        webGLContext.UNSIGNED_BYTE,
        sourcePixels
      )
    } finally {
      for (
        var pixelStoreIndex = changedPixelStoreParameters.length - 1;
        pixelStoreIndex >= 0;
        pixelStoreIndex -= 1
      ) {
        var changedPixelStoreParameter =
          changedPixelStoreParameters[pixelStoreIndex]
        try {
          webGLContext.pixelStorei(
            changedPixelStoreParameter.$rParameter,
            changedPixelStoreParameter.$rPreviousValue
          )
        } catch (_) {}
      }
      if (pixelPackBufferChanged) {
        try {
          webGLContext.bindBuffer(
            pixelPackBufferTarget,
            previousPixelPackBuffer
          )
        } catch (_) {}
      }
      if (framebufferChanged) {
        try {
          webGLContext.bindFramebuffer(
            framebufferTarget,
            previousFramebuffer
          )
        } catch (_) {}
      }
    }
  }

  function downsampleAndFlipWebGLPixels(readbackState) {
    var sourcePixels = readbackState.sourcePixels
    var targetPixels = readbackState.targetPixels
    var sourceWidth = readbackState.sourceWidth
    var sourceHeight = readbackState.sourceHeight
    var targetWidth = readbackState.targetWidth
    var targetHeight = readbackState.targetHeight

    for (var targetY = 0; targetY < targetHeight; targetY += 1) {
      var sourceY = Math.min(
        sourceHeight - 1,
        Math.floor(
          ((targetHeight - targetY - 0.5) * sourceHeight) / targetHeight
        )
      )
      var sourceRowOffset = sourceY * sourceWidth * 4
      var targetRowOffset = targetY * targetWidth * 4

      for (var targetX = 0; targetX < targetWidth; targetX += 1) {
        var sourceOffset =
          sourceRowOffset + readbackState.sourceXOffsets[targetX]
        var targetOffset = targetRowOffset + targetX * 4
        targetPixels[targetOffset] = sourcePixels[sourceOffset]
        targetPixels[targetOffset + 1] = sourcePixels[sourceOffset + 1]
        targetPixels[targetOffset + 2] = sourcePixels[sourceOffset + 2]
        targetPixels[targetOffset + 3] = sourcePixels[sourceOffset + 3]
      }
    }
  }

  function releaseWebGLStagingCanvas(canvas) {
    if (
      !stopped &&
      canvas &&
      availableWebGLStagingCanvases.length < maxConcurrentEncodes
    ) {
      availableWebGLStagingCanvases.push(canvas)
    } else {
      discardWebGLStagingCanvas(canvas)
    }
  }

  function discardWebGLStagingCanvas(canvas) {
    if (!canvas) {
      return
    }
    releaseWebGLReadbackState(canvas)
    var canvasBytes = webGLStagingCanvasBytes.get(canvas) || 0
    webGLStagingCanvasBytes.delete(canvas)
    webGLStagingCanvasAllocatedBytes = Math.max(
      webGLStagingCanvasAllocatedBytes - canvasBytes,
      0
    )
    try {
      canvas.width = 0
      canvas.height = 0
    } catch (_) {}
  }

  function releaseWebGLReadbackState(canvas) {
    var readbackState = webGLReadbackStateByStagingCanvas.get(canvas)
    if (!readbackState) {
      return
    }
    webGLReadbackStateByStagingCanvas.delete(canvas)
    if (readbackState.cached) {
      webGLReadbackCachedBytes = Math.max(
        webGLReadbackCachedBytes - readbackState.bytesCount,
        0
      )
    }
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
      return encodeWithWorker(job, encodeGeneration).catch(function (
        error
      ) {
        if (
          stopped ||
          job.$rCancelled ||
          encodeGeneration !== generation ||
          job.$rWebGLFrame ||
          (error && error.$rDoNotFallbackToMainThread)
        ) {
          throw error
        }
        return encodeCanvasOnMainThread(
          job.$rCanvas,
          configuration,
          job.$rEncodeOptions
        )
      })
    }
    if (job.$rWebGLFrame) {
      try {
        return Promise.resolve(
          encodeStagedWebGLFrameOnMainThread(job)
        )
      } catch (error) {
        return Promise.reject(error)
      }
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
    job.$rCallerTimeoutId = setTimeout(function () {
      if (job.$rCancelled) {
        return
      }
      var timeoutError = new Error('Canvas encode request timed out')
      job.$rCancelled = true
      if (job.$rSharedAdmission) {
        job.$rSharedAdmission.$rCancel(timeoutError)
      }
      job.$rReject(timeoutError)

      // Native canvas work cannot be cancelled and keeps its module-level
      // physical admission until it really settles. Release only this bridge's
      // logical slot so one hung createImageBitmap/toBlob cannot leave every
      // caller and scheduler pending forever.
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
        releaseCapturedWebGLFrame(job)
        job.$rSharedAdmission = undefined
        var activeJobIndex = activeJobs.indexOf(job)
        if (activeJobIndex !== -1) {
          activeJobs.splice(activeJobIndex, 1)
        }
        releaseJobSlot(job)
        runNextQueuedRequest()
      })
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
      releaseCapturedWebGLFrame(job)
      job.$rReject(error)
    })
    queuedRequests = []

    activeJobs.forEach(function (job) {
      job.$rCancelled = true
      clearJobCallerTimeout(job)
      // Main-thread canvas APIs such as createImageBitmap() and toBlob() cannot
      // be cancelled.  Reject the caller immediately, but keep the physical
      // encode admitted until its real promise settles.  Releasing the slot or
      // staged-frame count here would let repeated replay resets bypass both
      // concurrency watermarks and retain an unbounded number of native
      // encodes/staging surfaces.
      var cancelledBeforePhysicalStart = false
      if (job.$rSharedAdmission) {
        cancelledBeforePhysicalStart =
          job.$rSharedAdmission.$rCancel(error)
      }
      if (cancelledBeforePhysicalStart) {
        // A queued shared admission has not handed its staging surface to any
        // native API yet, so it is safe to release immediately. Waiting for a
        // promise finally turn here lets repeated reset/encode calls fill the
        // bounded WebGL staging queue with already-cancelled jobs.
        releaseCapturedWebGLFrame(job)
      }
      job.$rReject(error)
      // Keep the shared physical admission until the native promise settles,
      // but free this bridge's logical slot so a reset cannot strand every
      // future request behind an uncancellable hung job.
      releaseJobSlot(job)
    })
    activeJobs = []

    rejectPendingRequests(error)
    if (shouldStopWorker) {
      workerManager.stop()
    }
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
          $rCanvas: undefined,
          $rEncodeOptions: encodeOptions,
          $rResolve: resolve,
          $rReject: reject,
          $rCancelled: false,
          $rOccupiesSlot: false,
          $rSharedAdmission: undefined,
          $rCallerTimeoutId: undefined
        }
        if (isWebGLReplayCanvas(canvas)) {
          if (stagedWebGLFrameCount >= maxStagedWebGLFrames) {
            reject(
              new Error('Canvas encode bridge WebGL staging queue full')
            )
            return
          }
          try {
            job.$rWebGLFrame = captureWebGLFrame(canvas, encodeOptions)
          } catch (error) {
            reject(error)
            return
          }
        } else {
          job.$rCanvas = canvas
        }
        queuedRequests.push(job)
        runNextQueuedRequest()
      })
    },
    reset: function () {
      generation += 1
      cancelOutstandingJobs(new Error('Canvas encode bridge reset'))
    },
    stop: function () {
      stopped = true
      generation += 1
      cancelOutstandingJobs(new Error('Canvas encode bridge stopped'))
      availableWebGLStagingCanvases.forEach(function (canvas) {
        discardWebGLStagingCanvas(canvas)
      })
      availableWebGLStagingCanvases = []
      webGLStagingCanvasBytes = new WeakMap()
      webGLStagingCanvasAllocatedBytes = 0
      webGLReadbackStateByStagingCanvas = new WeakMap()
      webGLReadbackCachedBytes = 0
    },
    getWorkerStatus: function () {
      return workerManager.getStatus()
    }
  }
}
