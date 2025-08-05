import {
  addEventListener,
  concatBuffers,
  addTelemetryDebug,
  assign
} from '@cloudcare/browser-core'
export var DeflateEncoderStreamId = {
  REPLAY: 1,
  RUM: 2
}
export function createDeflateEncoder(worker, streamId) {
  var rawBytesCount = 0
  var compressedData = []
  var compressedDataTrailer

  var nextWriteActionId = 0
  var pendingWriteActions = []

  var wokerListener = addEventListener(worker, 'message', function (params) {
    var workerResponse = params.data
    if (
      workerResponse.type !== 'wrote' ||
      (workerResponse.streamId && workerResponse.streamId !== streamId)
    ) {
      return
    }

    rawBytesCount += workerResponse.additionalBytesCount
    compressedData.push(workerResponse.result)
    compressedDataTrailer = workerResponse.trailer
    var nextPendingAction = pendingWriteActions.shift()
    if (nextPendingAction && nextPendingAction.id === workerResponse.id) {
      if (nextPendingAction.writeCallback) {
        nextPendingAction.writeCallback(workerResponse.result.byteLength)
      } else if (nextPendingAction.finishCallback) {
        nextPendingAction.finishCallback()
      }
    } else {
      removeMessageListener()
      addTelemetryDebug('Worker responses received out of order.')
    }
  })
  function uint8ToBase64(uint8, start = 0, end = uint8.length) {
    // 截取需要的部分
    const sliced = uint8.slice(start, end)

    // 转成字符串
    const binary = Array.from(sliced, (byte) => String.fromCharCode(byte)).join(
      ''
    )

    // 编码成 base64
    return btoa(binary)
  }
  var removeMessageListener = wokerListener.stop
  function consumeResult() {
    var output =
      compressedData.length === 0
        ? new Uint8Array(0)
        : concatBuffers(compressedData.concat(compressedDataTrailer))
    var result = {
      rawBytesCount: rawBytesCount,
      output: output,
      outputBytesCount: output.byteLength,
      outputBase64Head: uint8ToBase64(output, 0, 6),
      outputBase64Tail: uint8ToBase64(output, output.byteLength - 6),
      encoding: 'deflate'
    }
    rawBytesCount = 0
    compressedData = []
    return result
  }

  function sendResetIfNeeded() {
    if (nextWriteActionId > 0) {
      worker.postMessage({
        action: 'reset',
        streamId: streamId
      })
      nextWriteActionId = 0
    }
  }
  return {
    isAsync: true,
    isEmpty: function () {
      return nextWriteActionId === 0
    },

    write: function (data, callback) {
      worker.postMessage({
        action: 'write',
        id: nextWriteActionId,
        data: data,
        streamId: streamId
      })
      pendingWriteActions.push({
        id: nextWriteActionId,
        writeCallback: callback,
        data: data
      })
      nextWriteActionId += 1
    },

    finish: function (callback) {
      sendResetIfNeeded()

      if (!pendingWriteActions.length) {
        callback(consumeResult())
      } else {
        // Make sure we do not call any write callback
        pendingWriteActions.forEach(function (pendingWriteAction) {
          delete pendingWriteAction.writeCallback
        })

        // Wait for the last action to finish before calling the finish callback
        pendingWriteActions[pendingWriteActions.length - 1].finishCallback =
          function () {
            return callback(consumeResult())
          }
      }
    },

    finishSync: function () {
      sendResetIfNeeded()

      var pendingData = pendingWriteActions
        .map(function (pendingWriteAction) {
          // Make sure we do not call any write or finish callback
          delete pendingWriteAction.writeCallback
          delete pendingWriteAction.finishCallback
          return pendingWriteAction.data
        })
        .join('')

      return assign(consumeResult(), {
        pendingData: pendingData
      })
    },

    estimateEncodedBytesCount: function (data) {
      // This is a rough estimation of the data size once it'll be encoded by deflate. We observed
      // that if it's the first chunk of data pushed to the stream, the ratio is lower (3-4), but
      // after that the ratio is greater (10+). We chose 8 here, which (on average) seems to produce
      // requests of the expected size.
      return data.length / 8
    },

    stop: function () {
      removeMessageListener()
    }
  }
}
