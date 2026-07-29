import {
  addEventListener,
  concatBuffers,
  addTelemetryDebug,
  assign,
  clearTimeout,
  ONE_SECOND,
  setTimeout
} from '@cloudcare/browser-core'
import { EncoderStreamId } from '../encoderStreamId'
export var DeflateEncoderStreamId = EncoderStreamId
export var DEFLATE_WORKER_ACTIVITY_TIMEOUT = 30 * ONE_SECOND
export var DEFLATE_WORKER_ACTIVITY_GRACE_TIMEOUT = ONE_SECOND
var ADLER32_MODULO = 65521
var DEFLATE_STORED_BLOCK_BYTES_LIMIT = 65535
var ZLIB_NO_COMPRESSION_HEADER = new Uint8Array([120, 1])
var SYNCHRONOUS_OUTPUT_LIMIT_ERROR =
  'Pending deflate data exceeds the synchronous output limit.'

function computeUtf8BytesCount(value) {
  var string = String(value)
  var stringLength = string.length
  var byteLength = 0
  var position
  var codePoint
  var nextCodePoint
  for (position = 0; position < stringLength; position += 1) {
    codePoint = string.charCodeAt(position)
    if (
      codePoint >= 0xd800 &&
      codePoint <= 0xdbff &&
      position + 1 < stringLength
    ) {
      nextCodePoint = string.charCodeAt(position + 1)
      if (nextCodePoint >= 0xdc00 && nextCodePoint <= 0xdfff) {
        codePoint =
          0x10000 +
          (codePoint - 0xd800) * 0x400 +
          (nextCodePoint - 0xdc00)
        position += 1
      }
    }
    byteLength +=
      codePoint < 0x80
        ? 1
        : codePoint < 0x800
          ? 2
          : codePoint < 0x10000
            ? 3
            : 4
  }
  return byteLength
}

function encodeUtf8(value, byteLength) {
  var string = String(value)
  if (typeof TextEncoder === 'function' && TextEncoder.prototype.encode) {
    return new TextEncoder().encode(string)
  }

  /* eslint-disable no-bitwise */
  var bytes = new Uint8Array(byteLength)
  var bytePosition = 0
  for (var position = 0; position < string.length; position += 1) {
    var codePoint = string.charCodeAt(position)
    if ((codePoint & 0xfc00) === 0xd800 && position + 1 < string.length) {
      var nextCodePoint = string.charCodeAt(position + 1)
      if ((nextCodePoint & 0xfc00) === 0xdc00) {
        codePoint =
          0x10000 +
          ((codePoint - 0xd800) << 10) +
          (nextCodePoint - 0xdc00)
        position += 1
      }
    }
    if (codePoint < 0x80) {
      bytes[bytePosition++] = codePoint
    } else if (codePoint < 0x800) {
      bytes[bytePosition++] = 0xc0 | (codePoint >>> 6)
      bytes[bytePosition++] = 0x80 | (codePoint & 0x3f)
    } else if (codePoint < 0x10000) {
      bytes[bytePosition++] = 0xe0 | (codePoint >>> 12)
      bytes[bytePosition++] = 0x80 | ((codePoint >>> 6) & 0x3f)
      bytes[bytePosition++] = 0x80 | (codePoint & 0x3f)
    } else {
      bytes[bytePosition++] = 0xf0 | (codePoint >>> 18)
      bytes[bytePosition++] = 0x80 | ((codePoint >>> 12) & 0x3f)
      bytes[bytePosition++] = 0x80 | ((codePoint >>> 6) & 0x3f)
      bytes[bytePosition++] = 0x80 | (codePoint & 0x3f)
    }
  }
  /* eslint-enable no-bitwise */
  return bytes
}

function readAdler32(trailer) {
  if (!trailer || trailer.length < 4) {
    throw new Error('Deflate worker response is missing its Adler32 trailer.')
  }
  var checksumOffset = trailer.length - 4
  return (
    trailer[checksumOffset] * 0x1000000 +
    trailer[checksumOffset + 1] * 0x10000 +
    trailer[checksumOffset + 2] * 0x100 +
    trailer[checksumOffset + 3]
  )
}

function updateAdler32(checksum, bytes) {
  var firstSum = checksum % 0x10000
  var secondSum = Math.floor(checksum / 0x10000)
  var position = 0
  while (position < bytes.length) {
    var end = Math.min(position + 5552, bytes.length)
    while (position < end) {
      firstSum += bytes[position]
      secondSum += firstSum
      position += 1
    }
    firstSum %= ADLER32_MODULO
    secondSum %= ADLER32_MODULO
  }
  return secondSum * 0x10000 + firstSum
}

function makeAdler32Trailer(checksum) {
  return new Uint8Array([
    Math.floor(checksum / 0x1000000) % 0x100,
    Math.floor(checksum / 0x10000) % 0x100,
    Math.floor(checksum / 0x100) % 0x100,
    checksum % 0x100
  ])
}

function makeFinalStoredDeflateBlocks(binaryData) {
  var blocksCount = Math.max(
    1,
    Math.ceil(binaryData.length / DEFLATE_STORED_BLOCK_BYTES_LIMIT)
  )
  var blocks = new Uint8Array(binaryData.length + blocksCount * 5)
  var inputOffset = 0
  var outputOffset = 0
  do {
    var blockLength = Math.min(
      DEFLATE_STORED_BLOCK_BYTES_LIMIT,
      binaryData.length - inputOffset
    )
    var invertedBlockLength = 0xffff - blockLength
    blocks[outputOffset] =
      inputOffset + blockLength === binaryData.length ? 1 : 0
    blocks[outputOffset + 1] = blockLength % 0x100
    blocks[outputOffset + 2] = Math.floor(blockLength / 0x100)
    blocks[outputOffset + 3] = invertedBlockLength % 0x100
    blocks[outputOffset + 4] = Math.floor(invertedBlockLength / 0x100)
    blocks.set(
      binaryData.subarray(inputOffset, inputOffset + blockLength),
      outputOffset + 5
    )
    inputOffset += blockLength
    outputOffset += blockLength + 5
  } while (inputOffset < binaryData.length)
  return blocks
}

function getCharactersCount(dataChunks) {
  return dataChunks.reduce(function (total, data) {
    return total + String(data).length
  }, 0)
}

function makeSynchronousResult(
  completedCompressedData,
  completedCompressedDataTrailer,
  completedRawBytesCount,
  pendingData,
  pendingCharactersCount,
  maxOutputBytes
) {
  var completedOutputBytesCount = completedCompressedData.reduce(function (
    total,
    chunk
  ) {
    return total + chunk.length
  },
  0)
  var minimumStoredBlocksCount = Math.max(
    1,
    Math.ceil(
      pendingCharactersCount / DEFLATE_STORED_BLOCK_BYTES_LIMIT
    )
  )
  var envelopeBytesCount =
    (completedCompressedData.length > 0
      ? completedOutputBytesCount
      : ZLIB_NO_COMPRESSION_HEADER.length) + 4
  if (
    envelopeBytesCount +
      pendingCharactersCount +
      minimumStoredBlocksCount * 5 >
    maxOutputBytes
  ) {
    throw new Error(SYNCHRONOUS_OUTPUT_LIMIT_ERROR)
  }

  // The UTF-16 lower-bound check above caps this scan to the output budget.
  // Compute exact UTF-8 sizes before TextEncoder so neither encoding nor output
  // allocation can exceed the synchronous unload budget.
  var pendingUtf8BytesCounts = pendingData.map(computeUtf8BytesCount)
  var pendingRawBytesCount = 0
  pendingUtf8BytesCounts.forEach(function (bytesCount) {
    pendingRawBytesCount += bytesCount
  })
  var storedBlocksCount = Math.max(
    1,
    Math.ceil(pendingRawBytesCount / DEFLATE_STORED_BLOCK_BYTES_LIMIT)
  )
  if (
    envelopeBytesCount + pendingRawBytesCount + storedBlocksCount * 5 >
    maxOutputBytes
  ) {
    throw new Error(SYNCHRONOUS_OUTPUT_LIMIT_ERROR)
  }

  var binaryChunks = pendingData.map(function (data, index) {
    return encodeUtf8(data, pendingUtf8BytesCounts[index])
  })
  var binaryData = concatBuffers(binaryChunks)
  var checksum =
    completedCompressedData.length > 0
      ? readAdler32(completedCompressedDataTrailer)
      : 1
  checksum = updateAdler32(checksum, binaryData)

  var outputParts =
    completedCompressedData.length > 0
      ? completedCompressedData.slice()
      : [ZLIB_NO_COMPRESSION_HEADER]
  outputParts.push(makeFinalStoredDeflateBlocks(binaryData))
  outputParts.push(makeAdler32Trailer(checksum))
  var output = concatBuffers(outputParts)
  return {
    rawBytesCount: completedRawBytesCount + pendingRawBytesCount,
    output: output,
    outputBytesCount: output.byteLength,
    encoding: 'deflate'
  }
}

export function createDeflateEncoder(worker, streamId, onTerminalError) {
  var rawBytesCount = 0
  var compressedData = []
  var compressedDataTrailer

  var isEmpty = true
  var nextWriteActionId = 0
  var pendingWriteActions = []
  var pendingWriteActionIndex = 0
  var pendingEncodedBytesCount = 0
  var pendingRawBytesCount = 0
  var pendingStreamError
  var terminalWorkerError
  var isTerminalErrorNotified = false
  var suppressWriteCallbacksThroughId = -1
  var activityTimeoutId

  var workerMessageListener = addEventListener(worker, 'message', function (
    params
  ) {
    var workerResponse = params.data
    if (workerResponse.type === 'initialized') {
      if (getPendingWriteActionCount() > 0) {
        refreshActivityWatchdog()
      }
      return
    }
    if (
      workerResponse.type === 'errored' &&
      (!workerResponse.streamId || workerResponse.streamId === streamId)
    ) {
      handleStreamError(
        workerResponse.error,
        workerResponse.streamId === undefined
      )
      return
    }
    if (
      workerResponse.type !== 'wrote' ||
      (workerResponse.streamId && workerResponse.streamId !== streamId)
    ) {
      return
    }
    var nextPendingAction = getNextPendingWriteAction()
    if (nextPendingAction) {
      if (nextPendingAction.id === workerResponse.id) {
        consumeNextPendingWriteAction()
        pendingEncodedBytesCount = Math.max(
          0,
          pendingEncodedBytesCount - nextPendingAction.estimatedBytesCount
        )
        pendingRawBytesCount = Math.max(
          0,
          pendingRawBytesCount - nextPendingAction.rawBytesCount
        )
        refreshActivityWatchdog()

        rawBytesCount += workerResponse.additionalBytesCount
        compressedData.push(workerResponse.result)
        compressedDataTrailer = workerResponse.trailer

        if (nextPendingAction.finishCallback) {
          nextPendingAction.finishCallback(
            nextPendingAction.$rDiscardOutput
              ? consumeDiscardedResult()
              : consumeResult()
          )
        } else if (
          nextPendingAction.writeCallback &&
          nextPendingAction.id > suppressWriteCallbacksThroughId
        ) {
          nextPendingAction.writeCallback(workerResponse.result.byteLength)
        }
      } else if (nextPendingAction.id < workerResponse.id) {
        addTelemetryDebug('Worker responses received out of order.')
        handleStreamError(
          new Error(
            'Worker responses received out of order for stream ' + streamId
          ),
          false
        )
      }
    }
  })
  var workerErrorListener = addEventListener(worker, 'error', function (error) {
    handleStreamError(error, true)
  })

  var removeMessageListener = workerMessageListener.stop
  var removeErrorListener = workerErrorListener.stop

  function getPendingWriteActionCount() {
    return pendingWriteActions.length - pendingWriteActionIndex
  }

  function getPendingWriteActions() {
    return pendingWriteActions.slice(pendingWriteActionIndex)
  }

  function getNextPendingWriteAction() {
    return pendingWriteActions[pendingWriteActionIndex]
  }

  function isWriteCallbackSuppressed(pendingAction) {
    return pendingAction.id <= suppressWriteCallbacksThroughId
  }

  function consumeNextPendingWriteAction() {
    var pendingWriteAction = pendingWriteActions[pendingWriteActionIndex]
    pendingWriteAction.data = undefined
    pendingWriteActions[pendingWriteActionIndex] = undefined
    pendingWriteActionIndex += 1
    if (pendingWriteActionIndex === pendingWriteActions.length) {
      clearPendingWriteActions()
    } else if (
      pendingWriteActionIndex >= 1024 &&
      pendingWriteActionIndex * 2 >= pendingWriteActions.length
    ) {
      pendingWriteActions = pendingWriteActions.slice(pendingWriteActionIndex)
      pendingWriteActionIndex = 0
    }
  }

  function clearPendingWriteActions() {
    pendingWriteActions = []
    pendingWriteActionIndex = 0
  }

  function clearActivityWatchdog() {
    if (activityTimeoutId !== undefined) {
      clearTimeout(activityTimeoutId)
      activityTimeoutId = undefined
    }
  }

  function refreshActivityWatchdog() {
    clearActivityWatchdog()
    if (terminalWorkerError || getPendingWriteActionCount() === 0) {
      return
    }
    activityTimeoutId = setTimeout(function () {
      activityTimeoutId = undefined
      if (terminalWorkerError || getPendingWriteActionCount() === 0) {
        return
      }
      // When the main thread is saturated, the timeout task can overtake an
      // already queued worker "wrote" event. Give that event source one
      // explicit grace turn before declaring the shared worker terminal.
      activityTimeoutId = setTimeout(function () {
        activityTimeoutId = undefined
        if (
          terminalWorkerError ||
          getPendingWriteActionCount() === 0
        ) {
          return
        }
        handleStreamError(
          new Error(
            'Deflate worker activity timed out for stream ' + streamId
          ),
          true
        )
      }, DEFLATE_WORKER_ACTIVITY_GRACE_TIMEOUT)
    }, DEFLATE_WORKER_ACTIVITY_TIMEOUT)
  }

  function notifyTerminalError(error) {
    if (isTerminalErrorNotified) {
      return
    }
    isTerminalErrorNotified = true
    if (onTerminalError) {
      onTerminalError(error)
    }
  }

  function consumeResult() {
    var output =
      compressedData.length === 0
        ? new Uint8Array(0)
        : concatBuffers(
            compressedDataTrailer
              ? compressedData.concat(compressedDataTrailer)
              : compressedData
          )

    var result = {
      rawBytesCount: rawBytesCount,
      output: output,
      outputBytesCount: output.byteLength,
      encoding: 'deflate'
    }
    rawBytesCount = 0
    compressedData = []
    compressedDataTrailer = undefined
    return result
  }

  function makeErrorResult(error) {
    return {
      rawBytesCount: 0,
      output: new Uint8Array(0),
      outputBytesCount: 0,
      encoding: 'deflate',
      error: error
    }
  }

  function consumeDiscardedResult() {
    rawBytesCount = 0
    compressedData = []
    compressedDataTrailer = undefined
    return {
      rawBytesCount: 0,
      output: new Uint8Array(0),
      outputBytesCount: 0,
      encoding: 'deflate'
    }
  }

  function postResetIfNeeded() {
    if (!isEmpty) {
      isEmpty = true
      try {
        worker.postMessage({
          action: 'reset',
          streamId: streamId
        })
      } catch (error) {
        return error
      }
    }
  }

  function handleStreamError(error, isTerminal) {
    clearActivityWatchdog()
    const pendingActions = getPendingWriteActions()
    const hasErrorCallback = pendingActions.some(function (pendingAction) {
      return (
        (pendingAction.writeCallback &&
          !isWriteCallbackSuppressed(pendingAction)) ||
        pendingAction.finishCallback
      )
    })
    clearPendingWriteActions()
    pendingEncodedBytesCount = 0
    pendingRawBytesCount = 0
    rawBytesCount = 0
    compressedData = []
    compressedDataTrailer = undefined
    if (isTerminal) {
      terminalWorkerError = error
      pendingStreamError = undefined
    } else {
      pendingStreamError = error
    }

    const shouldReset = !isEmpty
    isEmpty = true
    if (shouldReset && !isTerminal) {
      try {
        worker.postMessage({
          action: 'reset',
          streamId: streamId
        })
      } catch (_) {
        // The worker may no longer accept messages. The local stream still needs
        // to be released so future writes cannot retain the failed payload.
      }
    }

    pendingActions.forEach(function (pendingAction) {
      if (
        pendingAction.writeCallback &&
        !isWriteCallbackSuppressed(pendingAction)
      ) {
        pendingAction.writeCallback(0, error)
      }
    })
    pendingActions.forEach(function (pendingAction) {
      if (pendingAction.finishCallback) {
        pendingAction.finishCallback(makeErrorResult(error))
      }
    })
    if (hasErrorCallback && !isTerminal) {
      pendingStreamError = undefined
    }
    if (isTerminal) {
      notifyTerminalError(error)
    }
  }

  return {
    isAsync: true,
    isEmpty: function () {
      return isEmpty
    },

    write: function (data, callback) {
      if (terminalWorkerError) {
        if (callback) {
          callback(0, terminalWorkerError)
        }
        return
      }
      if (pendingStreamError) {
        if (callback) {
          const error = pendingStreamError
          pendingStreamError = undefined
          callback(0, error)
        }
        return
      }
      if (isEmpty && getPendingWriteActionCount() === 0) {
        pendingStreamError = undefined
      }
      const estimatedBytesCount = this.estimateEncodedBytesCount(data)
      pendingWriteActions.push({
        id: nextWriteActionId,
        writeCallback: callback,
        data: data,
        estimatedBytesCount: estimatedBytesCount,
        rawBytesCount: data.length * 2
      })
      pendingEncodedBytesCount += estimatedBytesCount
      pendingRawBytesCount += data.length * 2
      isEmpty = false
      const actionId = nextWriteActionId
      nextWriteActionId += 1
      if (getPendingWriteActionCount() === 1) {
        refreshActivityWatchdog()
      }
      try {
        worker.postMessage({
          action: 'write',
          id: actionId,
          data: data,
          streamId: streamId
        })
      } catch (error) {
        handleStreamError(error, true)
      }
    },

    finish: function (callback) {
      if (terminalWorkerError) {
        callback(makeErrorResult(terminalWorkerError))
        return
      }
      if (getPendingWriteActionCount() === 0) {
        clearActivityWatchdog()
        if (pendingStreamError) {
          const error = pendingStreamError
          pendingStreamError = undefined
          callback(makeErrorResult(error))
          return
        }
        const resetError = postResetIfNeeded()
        if (resetError) {
          terminalWorkerError = resetError
          rawBytesCount = 0
          compressedData = []
          compressedDataTrailer = undefined
          callback(makeErrorResult(resetError))
          notifyTerminalError(resetError)
        } else {
          callback(consumeResult())
        }
      } else {
        // Wait for the last action to finish before calling the finish callback
        const lastPendingWriteAction =
          pendingWriteActions[pendingWriteActions.length - 1]
        suppressWriteCallbacksThroughId = Math.max(
          suppressWriteCallbacksThroughId,
          lastPendingWriteAction.id
        )
        lastPendingWriteAction.finishCallback = callback
        const resetError = postResetIfNeeded()
        if (resetError) {
          handleStreamError(resetError, true)
        }
      }
    },

    $rFinishDiscard: function (callback) {
      var lastPendingWriteAction =
        pendingWriteActions[pendingWriteActions.length - 1]
      if (lastPendingWriteAction) {
        lastPendingWriteAction.$rDiscardOutput = true
      }
      this.finish(callback)
    },

    finishSync: function () {
      clearActivityWatchdog()
      var pendingData = getPendingWriteActions().map(
        function (pendingWriteAction) {
          return pendingWriteAction.data
        }
      )

      const resetError = postResetIfNeeded()
      clearPendingWriteActions()
      pendingEncodedBytesCount = 0
      pendingRawBytesCount = 0
      const result = assign(consumeResult(), {
        pendingData: pendingData
      })
      pendingStreamError = undefined
      if (terminalWorkerError) {
        result.error = terminalWorkerError
      }
      if (resetError) {
        terminalWorkerError = resetError
        result.error = resetError
        notifyTerminalError(resetError)
      }
      return result
    },

    flushPendingActionsSync: function (maxOutputBytes) {
      if (typeof maxOutputBytes !== 'number') {
        maxOutputBytes = Infinity
      }
      var pendingActions = getPendingWriteActions()
      if (
        pendingActions.length === 0 ||
        !pendingActions[pendingActions.length - 1].finishCallback
      ) {
        return
      }

      clearActivityWatchdog()
      var completedCompressedData = compressedData
      var completedCompressedDataTrailer = compressedDataTrailer
      var completedRawBytesCount = rawBytesCount
      var pendingData = []
      var completedGroups = []
      var remainingOutputBytes = maxOutputBytes
      var remainingCharactersToScan = maxOutputBytes

      pendingActions.forEach(function (pendingAction) {
        pendingData.push(pendingAction.data)
        if (!pendingAction.finishCallback) {
          return
        }
        var result
        if (pendingAction.$rDiscardOutput) {
          result = {
            rawBytesCount: 0,
            output: new Uint8Array(0),
            outputBytesCount: 0,
            encoding: 'deflate'
          }
        } else {
          var pendingCharactersCount = getCharactersCount(pendingData)
          if (pendingCharactersCount > remainingCharactersToScan) {
            result = makeErrorResult(
              new Error(SYNCHRONOUS_OUTPUT_LIMIT_ERROR)
            )
          } else {
            remainingCharactersToScan -= pendingCharactersCount
            try {
              result = makeSynchronousResult(
                completedCompressedData,
                completedCompressedDataTrailer,
                completedRawBytesCount,
                pendingData,
                pendingCharactersCount,
                remainingOutputBytes
              )
            } catch (error) {
              result = makeErrorResult(error)
            }
          }
        }
        if (!result.error && !pendingAction.$rDiscardOutput) {
          remainingOutputBytes -= result.outputBytesCount
        }
        completedGroups.push({
          callback: pendingAction.finishCallback,
          result: result
        })
        completedCompressedData = []
        completedCompressedDataTrailer = undefined
        completedRawBytesCount = 0
        pendingData = []
      })

      var lastPendingAction = pendingActions[pendingActions.length - 1]
      suppressWriteCallbacksThroughId = Math.max(
        suppressWriteCallbacksThroughId,
        lastPendingAction.id
      )
      var resetError = postResetIfNeeded()
      pendingActions.forEach(function (pendingAction) {
        pendingAction.data = undefined
      })
      clearPendingWriteActions()
      pendingEncodedBytesCount = 0
      pendingRawBytesCount = 0
      rawBytesCount = 0
      compressedData = []
      compressedDataTrailer = undefined
      pendingStreamError = undefined

      completedGroups.forEach(function (completedGroup) {
        completedGroup.callback(completedGroup.result)
      })
      if (resetError) {
        terminalWorkerError = resetError
        notifyTerminalError(resetError)
      }
    },

    estimateEncodedBytesCount: function (data) {
      // This is a rough estimation of the data size once it'll be encoded by deflate. We observed
      // that if it's the first chunk of data pushed to the stream, the ratio is lower (3-4), but
      // after that the ratio is greater (10+). We chose 8 here, which (on average) seems to produce
      // requests of the expected size.
      var charactersCount = typeof data === 'number' ? data : data.length
      return charactersCount / 8
    },

    getPendingEncodedBytesCount: function () {
      return pendingEncodedBytesCount
    },

    getPendingRawBytesCount: function () {
      return pendingRawBytesCount
    },

    stop: function () {
      clearActivityWatchdog()
      postResetIfNeeded()
      removeMessageListener()
      removeErrorListener()
      clearPendingWriteActions()
      pendingEncodedBytesCount = 0
      pendingRawBytesCount = 0
      rawBytesCount = 0
      compressedData = []
      compressedDataTrailer = undefined
      pendingStreamError = undefined
      terminalWorkerError = undefined
      suppressWriteCallbacksThroughId = -1
    }
  }
}
