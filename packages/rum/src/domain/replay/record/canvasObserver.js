import { timeStampNow } from '@cloudcare/browser-core'
import { IncrementalSource, RecordType } from '../../../types'
import { getSerializedNodeId, hasSerializedNode } from './serializationUtils'
import {
  buildSerializedCanvasImage,
  estimateEncodedBytesFromDataUrl
} from './canvasSerializeArgs'
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

export function createCanvasObserver(options) {
  var configuration = options.configuration
  var emit = options.emit
  var encodeBridge =
    options.encodeBridge || createCanvasEncodeBridge(configuration)
  var frameSignatureExtractor =
    options.frameSignatureExtractor || createCanvasFrameSignatureExtractor()
  var stopped = false
  var lastEncodedDataUrlByCanvas = new WeakMap()
  var lastAutoFrameSignatureByCanvas = new WeakMap()

  return {
    snapshot: function (canvas) {
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

      var autoFrameSignatureResult = getAutoFrameSignatureResult(
        canvas,
        configuration,
        frameSignatureExtractor,
        lastAutoFrameSignatureByCanvas
      )
      if (autoFrameSignatureResult) {
        return Promise.resolve(autoFrameSignatureResult)
      }

      return encodeBridge
        .encode(canvas)
        .then(function (encodedCanvas) {
          if (stopped) {
            return createSnapshotFailureResult('observer_stopped')
          }

          if (
            configuration.replayCanvasMode === 'auto' &&
            lastEncodedDataUrlByCanvas.get(canvas) === encodedCanvas.dataUrl
          ) {
            return createSnapshotFailureResult('unchanged')
          }

          var encodedBytesCount = estimateEncodedBytesFromDataUrl(
            encodedCanvas.dataUrl
          )
          if (
            encodedBytesCount > configuration.replayCanvasMaxEncodedBytes
          ) {
            return createSnapshotFailureResult('encode_too_large')
          }

          lastEncodedDataUrlByCanvas.set(canvas, encodedCanvas.dataUrl)

          emit({
            type: RecordType.IncrementalSnapshot,
            timestamp: timeStampNow(),
            data: {
              source: IncrementalSource.CanvasMutation,
              id: id,
              type: '2D',
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
            }
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
    }
  }
}

function getAutoFrameSignatureResult(
  canvas,
  configuration,
  frameSignatureExtractor,
  lastAutoFrameSignatureByCanvas
) {
  if (configuration.replayCanvasMode !== 'auto') {
    return undefined
  }

  var nextFrameSignature = frameSignatureExtractor(canvas)
  var previousFrameSignature = lastAutoFrameSignatureByCanvas.get(canvas)

  if (
    previousFrameSignature &&
    nextFrameSignature &&
    isCanvasFrameBelowThreshold(previousFrameSignature, nextFrameSignature)
  ) {
    return createSnapshotFailureResult('below_threshold')
  }

  if (nextFrameSignature) {
    lastAutoFrameSignatureByCanvas.set(canvas, nextFrameSignature)
  }

  return undefined
}
