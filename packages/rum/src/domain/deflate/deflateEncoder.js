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

  var isEmpty = true
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
    var nextPendingAction = pendingWriteActions[0]
    if (nextPendingAction) {
      if (nextPendingAction.id === workerResponse.id) {
        pendingWriteActions.shift()

        rawBytesCount += workerResponse.additionalBytesCount
        compressedData.push(workerResponse.result)
        compressedDataTrailer = workerResponse.trailer

        if (nextPendingAction.writeCallback) {
          nextPendingAction.writeCallback(workerResponse.result.byteLength)
        } else if (nextPendingAction.finishCallback) {
          nextPendingAction.finishCallback()
        }
      } else if (nextPendingAction.id < workerResponse.id) {
        removeMessageListener()
        addTelemetryDebug('Worker responses received out of order.')
      }
    }
    // rawBytesCount += workerResponse.additionalBytesCount
    // compressedData.push(workerResponse.result)
    // compressedDataTrailer = workerResponse.trailer
    // var nextPendingAction = pendingWriteActions.shift()
    // if (nextPendingAction && nextPendingAction.id === workerResponse.id) {
    //   if (nextPendingAction.writeCallback) {
    //     nextPendingAction.writeCallback(workerResponse.result.byteLength)
    //   } else if (nextPendingAction.finishCallback) {
    //     nextPendingAction.finishCallback()
    //   }
    // } else {
    //   removeMessageListener()
    //   addTelemetryDebug('Worker responses received out of order.')
    // }
  })

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
      encoding: 'deflate'
    }
    rawBytesCount = 0
    compressedData = []
    return result
  }

  function sendResetIfNeeded() {
    if (!isEmpty) {
      worker.postMessage({
        action: 'reset',
        streamId: streamId
      })
      isEmpty = true
    }
  }
  return {
    isAsync: true,
    isEmpty: function () {
      return isEmpty
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
      isEmpty = false
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
          return pendingWriteAction.data
        })
        .join('')
      pendingWriteActions.length = 0
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
