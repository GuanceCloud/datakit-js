var MAX_WEBGL_READBACK_PIXELS = 3840 * 2160
var MAX_WEBGL_READBACK_CAPTURE_BYTES = 16 * 1024 * 1024
var MAX_WEBGL_READBACK_CACHE_BYTES = 16 * 1024 * 1024
var MAX_WEBGL_STAGING_CANVAS_BYTES = 16 * 1024 * 1024
var MAX_WEBGL_ENCODE_CONCURRENCY = 4
var WEBGL_ENCODE_FALLBACK_CACHE_MS = 10000

function getRequiredFunction(host, name) {
  if (typeof host[name] !== 'function') {
    throw new Error('WebGL replay encoder requires ' + name)
  }
  return host[name]
}

function clampInteger(value, fallback, minimum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.max(Math.floor(value), minimum)
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
  encodeOptions = encodeOptions || {}
  return {
    mimeType: encodeOptions.mimeType || configuration.replayCanvasMimeType,
    quality:
      typeof encodeOptions.quality === 'number'
        ? encodeOptions.quality
        : configuration.replayCanvasQuality,
    maxSize:
      typeof encodeOptions.maxSize === 'number'
        ? encodeOptions.maxSize
        : configuration.replayCanvasMaxCanvasSize,
    maxEncodedBytes:
      typeof encodeOptions.maxEncodedBytes === 'number'
        ? encodeOptions.maxEncodedBytes
        : configuration.replayCanvasMaxEncodedBytes
  }
}

function isCanvasEncodeDropResult(result) {
  return (
    !!result &&
    result.ok === false &&
    result.reason === 'encode_too_large'
  )
}

function getWebGLFallbackTargetSize(targetSize) {
  return {
    width: Math.max(1, Math.round(targetSize.width * 0.4)),
    height: Math.max(1, Math.round(targetSize.height * 0.4))
  }
}

function getWebGLFallbackQuality(quality) {
  return typeof quality === 'number' && isFinite(quality)
    ? Math.min(quality, Math.max(quality * 0.5, 0.12))
    : quality
}

export function createWebGLReplayEncoder(host) {
  host = host || {}
  var configuration = host.configuration || {}
  var encodeCanvas = getRequiredFunction(host, 'hostEncodeCanvas')
  var getCanvasContextType = getRequiredFunction(
    host,
    'hostGetCanvasContextType'
  )
  var markInternalCanvas = getRequiredFunction(
    host,
    'hostMarkInternalCanvas'
  )
  var createCanvas =
    host.createCanvas ||
    function () {
      return document.createElement('canvas')
    }
  var createImageData =
    host.createImageData ||
    function (pixels, width, height) {
      return new ImageData(pixels, width, height)
    }
  var now = host.now || Date.now
  var createWebGLReadbackState =
    host.createWebGLReadbackState ||
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
  var maxConcurrentEncodes = Math.min(
    clampInteger(configuration.replayCanvasMaxConcurrentEncodes, 1, 1),
    MAX_WEBGL_ENCODE_CONCURRENCY
  )
  var maxStagedFrames = maxConcurrentEncodes * 2
  var stagedFrameCount = 0
  var inFlightCount = 0
  var generation = 0
  var stopped = false
  var queuedJobs = []
  var activeJobs = []
  var encodeProfileByCanvas = new WeakMap()
  var availableStagingCanvases = []
  var stagingCanvasBytes = new WeakMap()
  var stagingCanvasAllocatedBytes = 0
  var readbackStateByStagingCanvas = new WeakMap()
  var readbackCachedBytes = 0

  function createStagingCanvas() {
    return markInternalCanvas(createCanvas())
  }

  function getStagingCanvasBytes(targetSize) {
    var pixelCount = targetSize.width * targetSize.height
    if (
      !isFinite(pixelCount) ||
      pixelCount <= 0 ||
      pixelCount > MAX_WEBGL_STAGING_CANVAS_BYTES / 4
    ) {
      return Infinity
    }
    return pixelCount * 4
  }

  function resizeStagingCanvas(stagingCanvas, targetSize) {
    var previousBytes = stagingCanvasBytes.get(stagingCanvas) || 0
    var nextBytes = getStagingCanvasBytes(targetSize)
    if (
      nextBytes >
      MAX_WEBGL_STAGING_CANVAS_BYTES -
        (stagingCanvasAllocatedBytes - previousBytes)
    ) {
      var memoryBudgetError = new Error(
        'WebGL replay staging memory budget exceeded'
      )
      memoryBudgetError.$rDoNotFallback = true
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
    stagingCanvasAllocatedBytes =
      stagingCanvasAllocatedBytes - previousBytes + nextBytes
    stagingCanvasBytes.set(stagingCanvas, nextBytes)
  }

  function validateWebGLContextForCapture(canvas) {
    var contextType = getCanvasContextType(canvas)
    if (contextType !== 'webgl' && contextType !== 'webgl2') {
      throw new Error('Canvas is not marked as a WebGL replay canvas')
    }
    var webGLContext = canvas.getContext(contextType)
    if (!webGLContext || typeof webGLContext.readPixels !== 'function') {
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
      // This copy is intentionally synchronous. It runs at the draw boundary
      // selected by the observer, before preserveDrawingBuffer=false content
      // can be discarded by the browser.
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

  function prepareWebGLStagingCanvas(canvas, targetSize) {
    var stagingCanvas =
      availableStagingCanvases.pop() || createStagingCanvas()
    try {
      resizeStagingCanvas(stagingCanvas, targetSize)
      var stagingContext = stagingCanvas.getContext('2d')
      if (!stagingContext) {
        throw new Error('Cannot create canvas 2d context for WebGL staging')
      }
      validateWebGLContextForCapture(canvas)
      stagingContext.clearRect(0, 0, targetSize.width, targetSize.height)
      if (
        !copyWebGLFrameIntoStagingCanvas(
          canvas,
          stagingContext,
          targetSize
        ) &&
        !readWebGLFrameIntoStagingCanvas(
          canvas,
          stagingCanvas,
          stagingContext,
          targetSize
        )
      ) {
        throw new Error('Cannot copy WebGL canvas for replay encoding')
      }
      return stagingCanvas
    } catch (error) {
      discardStagingCanvas(stagingCanvas)
      throw error
    }
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
    var signature = [
      targetSize.width,
      targetSize.height,
      encodeConfiguration.mimeType,
      encodeConfiguration.quality,
      encodeConfiguration.maxEncodedBytes
    ].join('|')
    var profile = encodeProfileByCanvas.get(canvas)
    if (!profile || profile.$rSignature !== signature) {
      profile = {
        $rSignature: signature,
        $rNextProbeAt: 0,
        $rUpdateToken: 0
      }
      encodeProfileByCanvas.set(canvas, profile)
    }
    var currentTime = now()
    var useCachedFallback = profile.$rNextProbeAt > currentTime
    if (!useCachedFallback && profile.$rNextProbeAt) {
      profile.$rNextProbeAt = currentTime + WEBGL_ENCODE_FALLBACK_CACHE_MS
    }
    if (useCachedFallback) {
      targetSize = getWebGLFallbackTargetSize(targetSize)
      encodeConfiguration.quality = getWebGLFallbackQuality(
        encodeConfiguration.quality
      )
    }
    var canUpdateProfile = !useCachedFallback
    var frame = {
      $rCanvas: prepareWebGLStagingCanvas(canvas, targetSize),
      $rTargetSize: targetSize,
      $rEncodeConfiguration: encodeConfiguration,
      $rEncodeProfile: profile,
      $rCanUpdateProfile: canUpdateProfile,
      $rUpdateToken: canUpdateProfile ? ++profile.$rUpdateToken : 0,
      $rUsingFallback: useCachedFallback,
      $rCounted: true
    }
    stagedFrameCount += 1
    return frame
  }

  function makeHostEncodeOptions(frame, targetSize, quality) {
    return {
      mimeType: frame.$rEncodeConfiguration.mimeType,
      quality: quality,
      // The source is already synchronously staged at its target size. This
      // prevents the generic encoder from creating another resize surface.
      maxSize: Math.max(targetSize.width, targetSize.height),
      maxEncodedBytes: frame.$rEncodeConfiguration.maxEncodedBytes
    }
  }

  function callHostEncoder(canvas, encodeOptions) {
    var lifecycle
    try {
      lifecycle = encodeCanvas(canvas, encodeOptions)
    } catch (error) {
      return createRejectedEncodeLifecycle(error)
    }
    if (
      !lifecycle ||
      lifecycle.result === undefined ||
      lifecycle.physicalSettled === undefined
    ) {
      return createRejectedEncodeLifecycle(
        new Error('WebGL replay host returned an invalid encode lifecycle')
      )
    }
    return {
      result: Promise.resolve(lifecycle.result),
      physicalSettled: settleAsVoid(lifecycle.physicalSettled)
    }
  }

  function encodeFallbackFrame(job, previousResult) {
    var frame = job.$rFrame
    if (frame.$rUsingFallback || stopped || job.$rCancelled) {
      return createResolvedEncodeLifecycle(previousResult)
    }
    var fallbackSize = getWebGLFallbackTargetSize(frame.$rTargetSize)
    var fallbackCanvas =
      availableStagingCanvases.pop() || createStagingCanvas()
    try {
      resizeStagingCanvas(fallbackCanvas, fallbackSize)
      var context = fallbackCanvas.getContext('2d')
      if (!context) {
        throw new Error('Cannot create canvas 2d context for WebGL fallback')
      }
      context.clearRect(0, 0, fallbackSize.width, fallbackSize.height)
      context.drawImage(
        frame.$rCanvas,
        0,
        0,
        fallbackSize.width,
        fallbackSize.height
      )
      frame.$rUsingFallback = true
    } catch (error) {
      discardStagingCanvas(fallbackCanvas)
      return error && error.$rDoNotFallback
        ? createResolvedEncodeLifecycle(previousResult)
        : createRejectedEncodeLifecycle(error)
    }

    var fallbackLifecycle = callHostEncoder(
      fallbackCanvas,
      makeHostEncodeOptions(
        frame,
        fallbackSize,
        getWebGLFallbackQuality(frame.$rEncodeConfiguration.quality)
      )
    )
    return {
      result: fallbackLifecycle.result,
      physicalSettled: settleAsVoid(
        fallbackLifecycle.physicalSettled
      ).then(function () {
        releaseStagingCanvas(fallbackCanvas)
      })
    }
  }

  function encodeFrame(job, encodeGeneration) {
    var frame = job.$rFrame
    var fallbackLifecycle
    var firstLifecycle = callHostEncoder(
      frame.$rCanvas,
      makeHostEncodeOptions(
        frame,
        frame.$rTargetSize,
        frame.$rEncodeConfiguration.quality
      )
    )
    var resultPromise = firstLifecycle.result
      .then(function (result) {
        if (!isCanvasEncodeDropResult(result)) {
          return result
        }
        // The first encode may have resolved its logical result before an
        // uncancellable native canvas operation releases the source. Wait for
        // that physical boundary before drawing the same staging surface into
        // the lower-resolution fallback canvas.
        return firstLifecycle.physicalSettled.then(function () {
          fallbackLifecycle = encodeFallbackFrame(job, result)
          return fallbackLifecycle.result
        })
      })
      .then(function (result) {
        if (
          !job.$rCancelled &&
          encodeGeneration === generation &&
          frame.$rCanUpdateProfile &&
          frame.$rUpdateToken === frame.$rEncodeProfile.$rUpdateToken &&
          result &&
          (typeof result.dataUrl === 'string' ||
            (frame.$rUsingFallback &&
              result.reason === 'encode_too_large'))
        ) {
          frame.$rEncodeProfile.$rNextProbeAt = frame.$rUsingFallback
            ? now() + WEBGL_ENCODE_FALLBACK_CACHE_MS
            : 0
        }
        return result
      })
    return {
      result: resultPromise,
      physicalSettled: settleAsVoid(resultPromise).then(function () {
        return fallbackLifecycle
          ? fallbackLifecycle.physicalSettled
          : firstLifecycle.physicalSettled
      })
    }
  }

  function settleJob(job, method, value) {
    if (job.$rSettled) {
      return
    }
    job.$rSettled = true
    method(value)
  }

  function releaseCapturedFrame(job, reusable) {
    var frame = job.$rFrame
    if (!frame) {
      return
    }
    if (frame.$rCounted) {
      frame.$rCounted = false
      stagedFrameCount = Math.max(stagedFrameCount - 1, 0)
    }
    if (frame.$rCanvas) {
      var stagingCanvas = frame.$rCanvas
      frame.$rCanvas = undefined
      if (reusable && !stopped) {
        releaseStagingCanvas(stagingCanvas)
      } else {
        discardStagingCanvas(stagingCanvas)
      }
    }
  }

  function startJob(job) {
    inFlightCount += 1
    activeJobs.push(job)
    var encodeGeneration = generation
    var lifecycle = encodeFrame(job, encodeGeneration)
    lifecycle.result.then(
      function (result) {
        if (!job.$rCancelled && encodeGeneration === generation) {
          settleJob(job, job.$rResolve, result)
        }
      },
      function (error) {
        if (!job.$rCancelled && encodeGeneration === generation) {
          settleJob(job, job.$rReject, error)
        }
      }
    )
    lifecycle.physicalSettled.then(function () {
      finishJob(job, true)
    })
  }

  function finishJob(job, reusable) {
    var activeIndex = activeJobs.indexOf(job)
    if (activeIndex !== -1) {
      activeJobs.splice(activeIndex, 1)
    }
    releaseCapturedFrame(job, reusable)
    inFlightCount = Math.max(inFlightCount - 1, 0)
    runNextQueuedJob()
  }

  function runNextQueuedJob() {
    while (inFlightCount < maxConcurrentEncodes && queuedJobs.length) {
      var job = queuedJobs.shift()
      if (job.$rCancelled) {
        releaseCapturedFrame(job, false)
        continue
      }
      startJob(job)
    }
  }

  function cancelOutstandingJobs(message) {
    var error = new Error(message)
    queuedJobs.forEach(function (job) {
      job.$rCancelled = true
      settleJob(job, job.$rReject, error)
      releaseCapturedFrame(job, false)
    })
    queuedJobs = []
    activeJobs.forEach(function (job) {
      job.$rCancelled = true
      settleJob(job, job.$rReject, error)
      // Active staging surfaces remain owned by the generic encoder until its
      // promise settles. Releasing them here would allow reuse while a native
      // createImageBitmap()/toBlob() operation is still reading the surface.
    })
  }

  function releaseStagingCanvas(canvas) {
    if (
      !stopped &&
      canvas &&
      availableStagingCanvases.length < maxConcurrentEncodes
    ) {
      availableStagingCanvases.push(canvas)
    } else {
      discardStagingCanvas(canvas)
    }
  }

  function discardStagingCanvas(canvas) {
    if (!canvas) {
      return
    }
    releaseWebGLReadbackState(canvas)
    var canvasBytes = stagingCanvasBytes.get(canvas) || 0
    stagingCanvasBytes.delete(canvas)
    stagingCanvasAllocatedBytes = Math.max(
      stagingCanvasAllocatedBytes - canvasBytes,
      0
    )
    try {
      canvas.width = 0
      canvas.height = 0
    } catch (_) {}
  }

  function releaseWebGLReadbackState(canvas) {
    var readbackState = readbackStateByStagingCanvas.get(canvas)
    if (!readbackState) {
      return
    }
    readbackStateByStagingCanvas.delete(canvas)
    if (readbackState.cached) {
      readbackCachedBytes = Math.max(
        readbackCachedBytes - readbackState.bytesCount,
        0
      )
    }
  }

  function readWebGLFrameIntoStagingCanvas(
    canvas,
    stagingCanvas,
    stagingContext,
    targetSize
  ) {
    var contextType = getCanvasContextType(canvas)
    var webGLContext = canvas.getContext(contextType)
    if (!webGLContext || typeof webGLContext.readPixels !== 'function') {
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
      throw new Error('WebGL replay readback exceeds the peak memory limit')
    }

    var readbackState = readbackStateByStagingCanvas.get(stagingCanvas)
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
        MAX_WEBGL_READBACK_CACHE_BYTES - readbackCachedBytes
      ) {
        readbackState.cached = true
        readbackCachedBytes += readbackState.bytesCount
        readbackStateByStagingCanvas.set(stagingCanvas, readbackState)
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
      createImageData(
        readbackState.targetPixels,
        targetSize.width,
        targetSize.height
      ),
      0,
      0
    )
    return true
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
    var previousReadBuffer
    var readBufferChanged = false
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
        if (
          usesSeparateReadFramebuffer &&
          webGLContext.READ_BUFFER !== undefined &&
          typeof webGLContext.readBuffer === 'function'
        ) {
          previousReadBuffer = webGLContext.getParameter(
            webGLContext.READ_BUFFER
          )
        }
        webGLContext.bindFramebuffer(framebufferTarget, null)
        framebufferChanged = true
        if (
          previousReadBuffer !== undefined &&
          webGLContext.BACK !== undefined
        ) {
          webGLContext.readBuffer(webGLContext.BACK)
          readBufferChanged = true
        }
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
          if (readBufferChanged) {
            webGLContext.readBuffer(previousReadBuffer)
          }
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

  return {
    encode: function (canvas, encodeOptions) {
      return new Promise(function (resolve, reject) {
        if (stopped) {
          reject(new Error('WebGL replay encoder stopped'))
          return
        }
        if (stagedFrameCount >= maxStagedFrames) {
          reject(new Error('WebGL replay staging queue full'))
          return
        }
        var frame
        try {
          // Keep this inside the Promise executor: executors run synchronously,
          // so the original WebGL backing store is staged before encode()
          // returns to application rendering code.
          frame = captureWebGLFrame(canvas, encodeOptions)
        } catch (error) {
          reject(error)
          return
        }
        queuedJobs.push({
          $rFrame: frame,
          $rResolve: resolve,
          $rReject: reject,
          $rCancelled: false,
          $rSettled: false
        })
        runNextQueuedJob()
      })
    },
    reset: function () {
      generation += 1
      encodeProfileByCanvas = new WeakMap()
      cancelOutstandingJobs('WebGL replay encoder reset')
    },
    stop: function () {
      if (stopped) {
        return
      }
      stopped = true
      generation += 1
      encodeProfileByCanvas = new WeakMap()
      cancelOutstandingJobs('WebGL replay encoder stopped')
      availableStagingCanvases.forEach(function (canvas) {
        discardStagingCanvas(canvas)
      })
      availableStagingCanvases = []
    }
  }
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

function settleAsVoid(value) {
  return Promise.resolve(value).then(
    function () {},
    function () {}
  )
}

function createResolvedEncodeLifecycle(result) {
  return {
    result: Promise.resolve(result),
    physicalSettled: Promise.resolve()
  }
}

function createRejectedEncodeLifecycle(error) {
  return {
    result: Promise.reject(error),
    physicalSettled: Promise.resolve()
  }
}
