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

function getContinuousAutoEncodeOptions(canvas, configuration, snapshotOptions) {
  if (
    !snapshotOptions ||
    snapshotOptions.trigger !== 'auto' ||
    snapshotOptions.scheduler !== 'continuous_snapshot'
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
  var onMutationDebug = options.onMutationDebug || function () {}
  var now = options.now || Date.now
  var encodeBridge =
    options.encodeBridge || createCanvasEncodeBridge(configuration)
  var frameSignatureExtractor =
    options.frameSignatureExtractor || createCanvasFrameSignatureExtractor()
  var stopped = false
  var generation = 0
  var lastEncodedDataUrlByCanvas = new WeakMap()
  var lastAutoFrameSignatureByCanvas = new WeakMap()
  var lastAutoSuccessfulSnapshotAtByCanvas = new WeakMap()

  function reset() {
    generation += 1
    lastEncodedDataUrlByCanvas = new WeakMap()
    lastAutoFrameSignatureByCanvas = new WeakMap()
    lastAutoSuccessfulSnapshotAtByCanvas = new WeakMap()
  }

  return {
    snapshot: function (canvas, snapshotOptions) {
      var isAutoSnapshot = snapshotOptions && snapshotOptions.trigger === 'auto'
      var shouldTrackAutoBaseline =
        configuration.replayCanvasMode === 'auto'
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
      if (
        configuration.shouldRecordCanvas &&
        configuration.shouldRecordCanvas(canvas) === false
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
            isAutoSnapshot &&
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

          var mutationTimestamp = timeStampNow()
          emit(
            createEncodedCanvasMutationRecord({
              timestamp: mutationTimestamp,
              id: id,
              contextType: '2D',
              commands: [
                {
                  property: 'clearRect',
                  args: [0, 0, encodedCanvas.width, encodedCanvas.height]
                },
                {
                  property: 'drawImage',
                  args: [
                    buildSerializedCanvasImage(
                      encodedCanvas.dataUrl,
                      configuration.replayCanvasMimeType
                    ),
                    0,
                    0,
                    encodedCanvas.width,
                    encodedCanvas.height
                  ]
                }
              ],
              encodedBytesCount: encodedBytesCount
            })
          )
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
