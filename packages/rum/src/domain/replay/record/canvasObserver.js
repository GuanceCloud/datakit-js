import { timeStampNow } from '@cloudcare/browser-core'
import { getSerializedNodeId, hasSerializedNode } from './serializationUtils'
import {
  buildSerializedCanvasImage,
  estimateEncodedBytesFromDataUrl,
  getEncodedCanvasDataUrlDiagnostics,
  isValidEncodedCanvasDataUrl
} from './canvasSerializeArgs'
import { createEncodedCanvasMutationRecord } from './canvasMutationRecord'
import { createCanvasEncodeBridge } from './canvasEncodeBridge'
import {
  createCanvasFrameSignatureExtractor,
  isCanvasFrameBelowThreshold
} from './canvasFrameSignature'
import {
  getReplayCanvasRecordingDecision
} from './canvasContext'

var DEFAULT_ENCODED_DATA_URL_CACHE_MAX_CHARACTERS = 1024 * 1024
var MAX_ENCODED_DATA_URL_CACHE_ENTRIES = 64

function createSnapshotSuccessResult() {
  return { ok: true }
}

function createSnapshotFailureResult(reason) {
  return {
    ok: false,
    reason: reason
  }
}

function isSupportedReplayCanvasMode(mode) {
  return mode === 'manual' || mode === 'auto'
}

function createBitmapReplayStateResetCommands() {
  return [
    // reset() is the only 2D API that also clears the current clip and path.
    // Older replay browsers may not expose it, so keep the remaining commands
    // in the established CanvasMutation shape as a best-effort state reset.
    {
      property: 'reset',
      args: []
    },
    {
      property: 'setTransform',
      args: [1, 0, 0, 1, 0, 0]
    },
    {
      property: 'globalAlpha',
      args: [1],
      setter: true
    },
    {
      property: 'globalCompositeOperation',
      args: ['source-over'],
      setter: true
    },
    {
      property: 'filter',
      args: ['none'],
      setter: true
    },
    {
      property: 'shadowColor',
      args: ['rgba(0, 0, 0, 0)'],
      setter: true
    },
    {
      property: 'shadowBlur',
      args: [0],
      setter: true
    },
    {
      property: 'shadowOffsetX',
      args: [0],
      setter: true
    },
    {
      property: 'shadowOffsetY',
      args: [0],
      setter: true
    },
    {
      property: 'imageSmoothingEnabled',
      args: [true],
      setter: true
    }
  ]
}

function createBitmapReplayCommands(image, width, height) {
  return [
    {
      property: 'clearRect',
      args: [0, 0, width, height]
    },
    {
      property: 'drawImage',
      args: [image, 0, 0, width, height]
    }
  ]
}

function getContinuousAutoEncodeOptions(canvas, configuration, snapshotOptions) {
  if (
    !snapshotOptions ||
    snapshotOptions.trigger !== 'auto' ||
    (snapshotOptions.scheduler !== 'continuous_snapshot' &&
      snapshotOptions.scheduler !== 'webgl_snapshot')
  ) {
    return undefined
  }

  var pixelArea = canvas.width * canvas.height
  if (pixelArea < 120000) {
    return undefined
  }

  return {
    quality: Math.max(configuration.replayCanvasQuality * 0.75, 0.2),
    maxSize: Math.max(
      1,
      Math.round(configuration.replayCanvasMaxCanvasSize * 0.85)
    )
  }
}

export function createCanvasObserver(options) {
  var configuration = options.configuration
  var emit = options.emit
  var isNodeActive = options.isNodeActive || function () {
    return true
  }
  var onMutationDebug = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.onMutationDebug || function () {}
    : undefined
  var now = options.now || Date.now
  var encodeBridge =
    options.encodeBridge || createCanvasEncodeBridge(configuration)
  var frameSignatureExtractor =
    options.frameSignatureExtractor || createCanvasFrameSignatureExtractor()
  var flushMutations = options.flushMutations
  var configuredEncodedDataUrlCacheMaxCharacters =
    options.encodedDataUrlCacheMaxCharacters
  var encodedDataUrlCacheMaxCharacters =
    typeof configuredEncodedDataUrlCacheMaxCharacters === 'number' &&
    isFinite(configuredEncodedDataUrlCacheMaxCharacters)
      ? Math.max(0, Math.floor(configuredEncodedDataUrlCacheMaxCharacters))
      : DEFAULT_ENCODED_DATA_URL_CACHE_MAX_CHARACTERS
  var weakRefFactory = options.weakRefFactory
  if (!weakRefFactory && typeof WeakRef === 'function') {
    weakRefFactory = function (value) {
      return new WeakRef(value)
    }
  }
  var stopped = false
  var generation = 0
  var encodedDataUrlCacheEntries = []
  var encodedDataUrlCacheCharacters = 0
  var hasResetBitmapReplayStateByCanvas = new WeakSet()
  var lastAutoFrameSignatureByCanvas = new WeakMap()
  var lastAutoSuccessfulSnapshotAtByCanvas = new WeakMap()
  var lastReplayCurrentSnapshotSequenceByCanvas = new WeakMap()
  var nextSnapshotSequence = 0

  function clearEncodedDataUrlCache() {
    encodedDataUrlCacheEntries = []
    encodedDataUrlCacheCharacters = 0
  }

  function removeEncodedDataUrlCacheEntry(index) {
    var entry = encodedDataUrlCacheEntries[index]
    encodedDataUrlCacheCharacters -= entry[1].length
    encodedDataUrlCacheEntries.splice(index, 1)
  }

  function findEncodedDataUrlCacheEntry(canvas) {
    for (
      var index = encodedDataUrlCacheEntries.length - 1;
      index >= 0;
      index -= 1
    ) {
      var cachedCanvas = encodedDataUrlCacheEntries[index][0].deref()
      if (!cachedCanvas) {
        removeEncodedDataUrlCacheEntry(index)
      } else if (cachedCanvas === canvas) {
        return index
      }
    }
    return -1
  }

  function isLastEncodedDataUrl(canvas, dataUrl) {
    var entryIndex = findEncodedDataUrlCacheEntry(canvas)
    if (entryIndex === -1) {
      return false
    }
    var entry = encodedDataUrlCacheEntries[entryIndex]
    if (entryIndex !== encodedDataUrlCacheEntries.length - 1) {
      encodedDataUrlCacheEntries.splice(entryIndex, 1)
      encodedDataUrlCacheEntries.push(entry)
    }
    return entry[1] === dataUrl
  }

  function setLastEncodedDataUrl(canvas, dataUrl) {
    var previousEntryIndex = findEncodedDataUrlCacheEntry(canvas)
    if (previousEntryIndex !== -1) {
      removeEncodedDataUrlCacheEntry(previousEntryIndex)
    }

    // Keep exact strings only: an eviction can cause an extra bitmap, while a
    // hash collision could incorrectly discard a real frame. The bounded LRU
    // stores only WeakRefs to canvases, so it cannot retain a detached canvas
    // and its GPU backing store. Older browsers without WeakRef simply skip
    // this optional unchanged-frame cache.
    if (
      !weakRefFactory ||
      dataUrl.length > encodedDataUrlCacheMaxCharacters
    ) {
      return
    }

    var canvasRef
    try {
      canvasRef = weakRefFactory(canvas)
    } catch (_) {
      return
    }
    if (!canvasRef || typeof canvasRef.deref !== 'function') {
      return
    }
    encodedDataUrlCacheEntries.push([canvasRef, dataUrl])
    encodedDataUrlCacheCharacters += dataUrl.length
    while (
      encodedDataUrlCacheCharacters > encodedDataUrlCacheMaxCharacters ||
      encodedDataUrlCacheEntries.length >
        MAX_ENCODED_DATA_URL_CACHE_ENTRIES
    ) {
      removeEncodedDataUrlCacheEntry(0)
    }
  }

  function reset() {
    generation += 1
    if (encodeBridge.reset) {
      encodeBridge.reset()
    }
    clearEncodedDataUrlCache()
    hasResetBitmapReplayStateByCanvas = new WeakSet()
    lastAutoFrameSignatureByCanvas = new WeakMap()
    lastAutoSuccessfulSnapshotAtByCanvas = new WeakMap()
    lastReplayCurrentSnapshotSequenceByCanvas = new WeakMap()
    nextSnapshotSequence = 0
  }

  function isSnapshotSupersededByReplayCurrentFrame(canvas, snapshotSequence) {
    return (
      snapshotSequence <
      (lastReplayCurrentSnapshotSequenceByCanvas.get(canvas) || 0)
    )
  }

  function markSnapshotReplayCurrent(canvas, snapshotSequence) {
    lastReplayCurrentSnapshotSequenceByCanvas.set(
      canvas,
      snapshotSequence
    )
  }

  function flushCanvasDimensionMutation(canvas) {
    if (flushMutations) {
      try {
        if (flushMutations(canvas) === false) {
          return false
        }
      } catch (_) {
        return false
      }
    }
    return true
  }

  function isSnapshotCancelled(snapshotOptions) {
    if (
      !snapshotOptions ||
      typeof snapshotOptions.$rIsCancelled !== 'function'
    ) {
      return false
    }
    try {
      return snapshotOptions.$rIsCancelled()
    } catch (_) {
      return true
    }
  }

  return {
    snapshot: function (canvas, snapshotOptions) {
      var isAutoSnapshot = snapshotOptions && snapshotOptions.trigger === 'auto'
      var isForcedSnapshot = snapshotOptions && snapshotOptions.force === true
      var shouldSkipFrameSignature =
        snapshotOptions &&
        (snapshotOptions.scheduler === 'webgl_snapshot' ||
          snapshotOptions.scheduler === 'full_snapshot_baseline')
      var shouldResetBitmapReplayState =
        snapshotOptions && snapshotOptions.scheduler === 'command_capture'
      var shouldTrackAutoBaseline =
        configuration.replayCanvasMode === 'auto' &&
        !shouldSkipFrameSignature
      if (stopped) {
        return Promise.resolve(createSnapshotFailureResult('observer_stopped'))
      }
      if (!configuration.replayCanvasEnabled) {
        return Promise.resolve(createSnapshotFailureResult('replay_disabled'))
      }
      if (!isSupportedReplayCanvasMode(configuration.replayCanvasMode)) {
        return Promise.resolve(createSnapshotFailureResult('invalid_mode'))
      }
      if (!(canvas instanceof HTMLCanvasElement)) {
        return Promise.resolve(createSnapshotFailureResult('not_canvas'))
      }
      if (!hasSerializedNode(canvas)) {
        return Promise.resolve(createSnapshotFailureResult('not_serialized'))
      }
      var id = getSerializedNodeId(canvas)
      if (!id || !canvas.isConnected) {
        return Promise.resolve(createSnapshotFailureResult('detached'))
      }
      var replayTargetWidth = canvas.width
      var replayTargetHeight = canvas.height
      if (
        getReplayCanvasRecordingDecision(configuration, canvas) === false
      ) {
        return Promise.resolve(
          createSnapshotFailureResult('rejected_by_should_record_canvas')
        )
      }
      if (!flushCanvasDimensionMutation(canvas)) {
        return Promise.resolve(
          createSnapshotFailureResult('dimension_mutation_flush_failed')
        )
      }

      var snapshotGeneration = generation
      nextSnapshotSequence += 1
      var snapshotSequence = nextSnapshotSequence
      var autoFrameSignatureResult = getAutoFrameSignatureResult({
        canvas: canvas,
        configuration: configuration,
        now: now,
        frameSignatureExtractor: frameSignatureExtractor,
        lastAutoFrameSignatureByCanvas: lastAutoFrameSignatureByCanvas,
        lastAutoSuccessfulSnapshotAtByCanvas:
          lastAutoSuccessfulSnapshotAtByCanvas,
        isAutoSnapshot: isAutoSnapshot,
        isForcedSnapshot: isForcedSnapshot,
        shouldTrackAutoBaseline: shouldTrackAutoBaseline
      })
      if (autoFrameSignatureResult && autoFrameSignatureResult.result) {
        markSnapshotReplayCurrent(canvas, snapshotSequence)
        return Promise.resolve(autoFrameSignatureResult.result)
      }

      var encodeOptions = getContinuousAutoEncodeOptions(
        canvas,
        configuration,
        snapshotOptions
      )
      return encodeBridge
        .encode(canvas, encodeOptions)
        .then(function (encodedCanvas) {
          if (stopped) {
            return createSnapshotFailureResult('observer_stopped')
          }
          if (snapshotGeneration !== generation) {
            return createSnapshotFailureResult('reset_during_snapshot')
          }
          if (isSnapshotCancelled(snapshotOptions)) {
            return createSnapshotFailureResult('baseline_timeout')
          }
          if (
            isSnapshotSupersededByReplayCurrentFrame(
              canvas,
              snapshotSequence
            )
          ) {
            return createSnapshotFailureResult('superseded')
          }
          if (
            canvas.width !== replayTargetWidth ||
            canvas.height !== replayTargetHeight
          ) {
            return createSnapshotFailureResult('resized_during_snapshot')
          }
          if (!isNodeActive(canvas)) {
            return createSnapshotFailureResult('not_serialized')
          }
          if (
            encodedCanvas &&
            encodedCanvas.ok === false &&
            encodedCanvas.reason
          ) {
            return createSnapshotFailureResult(encodedCanvas.reason)
          }

          if (
            isAutoSnapshot &&
            !isForcedSnapshot &&
            isLastEncodedDataUrl(canvas, encodedCanvas.dataUrl)
          ) {
            markSnapshotReplayCurrent(canvas, snapshotSequence)
            return createSnapshotFailureResult('unchanged')
          }

          var encodedBytesCount = estimateEncodedBytesFromDataUrl(
            encodedCanvas.dataUrl
          )
          if (!isValidEncodedCanvasDataUrl(encodedCanvas.dataUrl)) {
            if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
              onMutationDebug({
                timestamp: timeStampNow(),
                canvasId: id,
                trigger:
                  snapshotOptions && snapshotOptions.trigger === 'auto'
                    ? 'auto'
                    : 'manual',
                reason: 'invalid_encoded_payload',
                width: encodedCanvas.width,
                height: encodedCanvas.height,
                encodedBytesCount: encodedBytesCount,
                diagnostics: getEncodedCanvasDataUrlDiagnostics(
                  encodedCanvas.dataUrl
                )
              })
            }
            return createSnapshotFailureResult('invalid_encoded_payload')
          }
          if (
            encodedBytesCount > configuration.replayCanvasMaxEncodedBytes
          ) {
            return createSnapshotFailureResult('encode_too_large')
          }

          var mutationTimestamp = timeStampNow()
          var shouldIncludeBitmapReplayStateReset =
            shouldResetBitmapReplayState &&
            !hasResetBitmapReplayStateByCanvas.has(canvas)
          var bitmapReplayCommands = createBitmapReplayCommands(
            buildSerializedCanvasImage(
              encodedCanvas.dataUrl,
              configuration.replayCanvasMimeType
            ),
            replayTargetWidth,
            replayTargetHeight
          )
          if (shouldIncludeBitmapReplayStateReset) {
            // The reset is destructive, so it must be admitted atomically with
            // the replacement bitmap. Otherwise segment backpressure can
            // publish a reset-only record and leave replay blank until a later
            // frame. Only this first fallback frame carries the reset; later
            // clearRect+drawImage frames keep their replaceable shape.
            bitmapReplayCommands =
              createBitmapReplayStateResetCommands().concat(
                bitmapReplayCommands
              )
          }
          var recordAccepted = emit(
            createEncodedCanvasMutationRecord({
              timestamp: mutationTimestamp,
              id: id,
              contextType: '2D',
              commands: bitmapReplayCommands,
              encodedBytesCount: encodedBytesCount
            })
          )
          if (recordAccepted === false) {
            if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
              onMutationDebug({
                timestamp: mutationTimestamp,
                canvasId: id,
                trigger:
                  snapshotOptions && snapshotOptions.trigger === 'auto'
                    ? 'auto'
                    : 'manual',
                reason: 'record_rejected',
                encodedBytesCount: encodedBytesCount,
                width: encodedCanvas.width,
                height: encodedCanvas.height
              })
            }
            return createSnapshotFailureResult('record_rejected')
          }
          markSnapshotReplayCurrent(canvas, snapshotSequence)
          if (shouldIncludeBitmapReplayStateReset) {
            hasResetBitmapReplayStateByCanvas.add(canvas)
          }
          if (
            snapshotOptions &&
            snapshotOptions.scheduler === 'full_snapshot_baseline'
          ) {
            // A full snapshot creates a fresh replay canvas. Its admitted
            // bitmap baseline therefore already starts from the default 2D
            // state and does not need a later standalone reset mutation.
            hasResetBitmapReplayStateByCanvas.add(canvas)
          }

          setLastEncodedDataUrl(canvas, encodedCanvas.dataUrl)
          if (shouldTrackAutoBaseline) {
            if (autoFrameSignatureResult && autoFrameSignatureResult.nextFrameSignature) {
              lastAutoFrameSignatureByCanvas.set(
                canvas,
                autoFrameSignatureResult.nextFrameSignature
              )
            }
            lastAutoSuccessfulSnapshotAtByCanvas.set(canvas, now())
          }
          if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
            onMutationDebug({
              timestamp: mutationTimestamp,
              canvasId: id,
              trigger:
                snapshotOptions && snapshotOptions.trigger === 'auto'
                  ? 'auto'
                  : 'manual',
              encodedBytesCount: encodedBytesCount,
              width: encodedCanvas.width,
              height: encodedCanvas.height
            })
          }
          return createSnapshotSuccessResult()
        })
        .catch(function (error) {
          if (snapshotGeneration !== generation) {
            return createSnapshotFailureResult('reset_during_snapshot')
          }
          if (isSnapshotCancelled(snapshotOptions)) {
            return createSnapshotFailureResult('baseline_timeout')
          }
          if (
            isSnapshotSupersededByReplayCurrentFrame(
              canvas,
              snapshotSequence
            )
          ) {
            return createSnapshotFailureResult('superseded')
          }
          if (error && error.ok === false && error.reason) {
            return error
          }
          return createSnapshotFailureResult('encode_failed')
        })
    },
    stop: function () {
      stopped = true
      clearEncodedDataUrlCache()
      encodeBridge.stop()
    },
    reset: function () {
      reset()
    }
  }
}

function getAutoFrameSignatureResult(options) {
  if (
    !options.shouldTrackAutoBaseline ||
    options.configuration.replayCanvasMode !== 'auto'
  ) {
    return undefined
  }

  var nextFrameSignature = options.frameSignatureExtractor(options.canvas)
  var previousFrameSignature = options.lastAutoFrameSignatureByCanvas.get(
    options.canvas
  )
  var lastAutoSuccessfulSnapshotAt =
    options.lastAutoSuccessfulSnapshotAtByCanvas.get(options.canvas)
  var canSkipBelowThreshold =
    typeof lastAutoSuccessfulSnapshotAt === 'number' &&
    options.now() - lastAutoSuccessfulSnapshotAt <
      options.configuration.replayCanvasAutoUnchangedBackoff

  if (
    options.isAutoSnapshot &&
    !options.isForcedSnapshot &&
    canSkipBelowThreshold &&
    previousFrameSignature &&
    nextFrameSignature &&
    isCanvasFrameBelowThreshold(previousFrameSignature, nextFrameSignature)
  ) {
    return {
      result: createSnapshotFailureResult('below_threshold'),
      nextFrameSignature: nextFrameSignature
    }
  }

  return {
    nextFrameSignature: nextFrameSignature
  }
}
