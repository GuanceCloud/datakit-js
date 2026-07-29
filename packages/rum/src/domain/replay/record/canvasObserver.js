import { timeStampNow } from '@cloudcare/browser-core'
import { getSerializedNodeId, hasSerializedNode } from './serializationUtils'
import {
  buildSerializedCanvasImage,
  estimateEncodedBytesFromDataUrl,
  getEncodedCanvasDataUrlDiagnostics,
  isValidEncodedCanvasDataUrl
} from './canvasSerializeArgs'
import {
  createCanvasMutationRecord,
  createEncodedCanvasMutationRecord
} from './canvasMutationRecord'
import { createCanvasEncodeBridge } from './canvasEncodeBridge'
import {
  createCanvasFrameSignatureExtractor,
  isCanvasFrameBelowThreshold
} from './canvasFrameSignature'
import { getReplayCanvasRecordingDecision } from './canvasContext'

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
  var onMutationDebug = options.onMutationDebug || function () {}
  var now = options.now || Date.now
  var encodeBridge =
    options.encodeBridge || createCanvasEncodeBridge(configuration)
  var frameSignatureExtractor =
    options.frameSignatureExtractor || createCanvasFrameSignatureExtractor()
  var stopped = false
  var generation = 0
  var lastEncodedDataUrlByCanvas = new WeakMap()
  var hasResetBitmapReplayStateByCanvas = new WeakSet()
  var lastAutoFrameSignatureByCanvas = new WeakMap()
  var lastAutoSuccessfulSnapshotAtByCanvas = new WeakMap()
  var lastSettledSnapshotSequenceByCanvas = new WeakMap()
  var nextSnapshotSequence = 0

  function reset() {
    generation += 1
    if (encodeBridge.reset) {
      encodeBridge.reset()
    }
    lastEncodedDataUrlByCanvas = new WeakMap()
    hasResetBitmapReplayStateByCanvas = new WeakSet()
    lastAutoFrameSignatureByCanvas = new WeakMap()
    lastAutoSuccessfulSnapshotAtByCanvas = new WeakMap()
    lastSettledSnapshotSequenceByCanvas = new WeakMap()
    nextSnapshotSequence = 0
  }

  function isSnapshotCompletionSuperseded(canvas, snapshotSequence) {
    var lastSettledSnapshotSequence =
      lastSettledSnapshotSequenceByCanvas.get(canvas) || 0
    if (snapshotSequence < lastSettledSnapshotSequence) {
      return true
    }
    // Promise callbacks run to completion, so advancing this watermark before
    // validation/emit makes every later completion for the same canvas
    // monotonic without penalizing snapshots that resolve in request order.
    lastSettledSnapshotSequenceByCanvas.set(canvas, snapshotSequence)
    return false
  }

  return {
    snapshot: function (canvas, snapshotOptions) {
      var isAutoSnapshot = snapshotOptions && snapshotOptions.trigger === 'auto'
      var isForcedSnapshot = snapshotOptions && snapshotOptions.force === true
      var isWebGLSnapshot =
        snapshotOptions && snapshotOptions.scheduler === 'webgl_snapshot'
      var shouldResetBitmapReplayState =
        snapshotOptions && snapshotOptions.scheduler === 'command_capture'
      var shouldTrackAutoBaseline =
        configuration.replayCanvasMode === 'auto' && !isWebGLSnapshot
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

      var snapshotGeneration = generation
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
        return Promise.resolve(autoFrameSignatureResult.result)
      }

      var encodeOptions = getContinuousAutoEncodeOptions(
        canvas,
        configuration,
        snapshotOptions
      )
      nextSnapshotSequence += 1
      var snapshotSequence = nextSnapshotSequence

      return encodeBridge
        .encode(canvas, encodeOptions)
        .then(function (encodedCanvas) {
          if (stopped) {
            return createSnapshotFailureResult('observer_stopped')
          }
          if (snapshotGeneration !== generation) {
            return createSnapshotFailureResult('reset_during_snapshot')
          }
          if (
            isSnapshotCompletionSuperseded(canvas, snapshotSequence)
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
            lastEncodedDataUrlByCanvas.get(canvas) === encodedCanvas.dataUrl
          ) {
            return createSnapshotFailureResult('unchanged')
          }

          var encodedBytesCount = estimateEncodedBytesFromDataUrl(
            encodedCanvas.dataUrl
          )
          if (!isValidEncodedCanvasDataUrl(encodedCanvas.dataUrl)) {
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
            return createSnapshotFailureResult('invalid_encoded_payload')
          }
          if (
            encodedBytesCount > configuration.replayCanvasMaxEncodedBytes
          ) {
            return createSnapshotFailureResult('encode_too_large')
          }

          var mutationTimestamp = timeStampNow()
          if (
            shouldResetBitmapReplayState &&
            !hasResetBitmapReplayStateByCanvas.has(canvas)
          ) {
            // Keep the state reset separate and emit it once per full-snapshot
            // generation. Existing players identify an exact
            // clearRect+drawImage pair as a replaceable self-contained frame.
            var stateResetAccepted = emit(
              createCanvasMutationRecord({
                timestamp: mutationTimestamp,
                id: id,
                contextType: '2D',
                commands: createBitmapReplayStateResetCommands()
              })
            )
            if (stateResetAccepted === false) {
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
              return createSnapshotFailureResult('record_rejected')
            }
            hasResetBitmapReplayStateByCanvas.add(canvas)
          }
          var recordAccepted = emit(
            createEncodedCanvasMutationRecord({
              timestamp: mutationTimestamp,
              id: id,
              contextType: '2D',
              commands: createBitmapReplayCommands(
                buildSerializedCanvasImage(
                  encodedCanvas.dataUrl,
                  configuration.replayCanvasMimeType
                ),
                replayTargetWidth,
                replayTargetHeight
              ),
              encodedBytesCount: encodedBytesCount
            })
          )
          if (recordAccepted === false) {
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
            return createSnapshotFailureResult('record_rejected')
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

          lastEncodedDataUrlByCanvas.set(canvas, encodedCanvas.dataUrl)
          if (shouldTrackAutoBaseline) {
            if (autoFrameSignatureResult && autoFrameSignatureResult.nextFrameSignature) {
              lastAutoFrameSignatureByCanvas.set(
                canvas,
                autoFrameSignatureResult.nextFrameSignature
              )
            }
            lastAutoSuccessfulSnapshotAtByCanvas.set(canvas, now())
          }
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
          return createSnapshotSuccessResult()
        })
        .catch(function (error) {
          if (snapshotGeneration !== generation) {
            return createSnapshotFailureResult('reset_during_snapshot')
          }
          if (
            isSnapshotCompletionSuperseded(canvas, snapshotSequence)
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
