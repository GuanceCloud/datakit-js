import { concatBuffers } from '@cloudcare/browser-core/worker'
import { Deflate, constants, string2buf } from '../domain/deflate'

export function startWorker(workerScope) {
  if (workerScope === undefined) {
    workerScope = self
  }
  try {
    var streams = new Map()
    workerScope.addEventListener('message', function (event) {
      try {
        var response = handleAction(streams, event.data)
        if (response) {
          workerScope.postMessage(response)
        }
      } catch (error) {
        sendError(
          workerScope,
          error,
          event.data && 'streamId' in event.data
            ? event.data.streamId
            : undefined
        )
      }
    })
  } catch (error) {
    sendError(workerScope, error)
  }
}

function sendError(workerScope, error, streamId) {
  try {
    workerScope.postMessage({
      type: 'errored',
      error: error,
      streamId
    })
  } catch (_) {
    // DATA_CLONE_ERR, cf https://developer.mozilla.org/en-US/docs/Web/API/Web_Workers_API/Structured_clone_algorithm
    workerScope.postMessage({
      type: 'errored',
      error: String(error),
      streamId
    })
  }
}

function handleAction(streams, message) {
  switch (message.action) {
    case 'init':
      return {
        type: 'initialized',
        version: __BUILD_ENV__SDK_VERSION__
      }

    case 'write': {
      var deflate = streams.get(message.streamId)
      if (!deflate) {
        deflate = new Deflate()
        streams.set(message.streamId, deflate)
      }
      var previousChunksLength = deflate.chunks.length

      // TextEncoder is not supported on old browser version like Edge 18, therefore we use string2buf
      var binaryData = string2buf(message.data)
      deflate.push(binaryData, constants.Z_SYNC_FLUSH)

      return {
        type: 'wrote',
        id: message.id,
        streamId: message.streamId,
        result: concatBuffers(deflate.chunks.slice(previousChunksLength)),
        trailer: makeTrailer(deflate),
        additionalBytesCount: binaryData.length
      }
    }

    case 'reset':
      streams.delete(message.streamId)
      break
  }
}

/**
 * Creates a buffer of bytes to append to the end of the Zlib stream to finish it. It is composed of
 * two parts:
 * * an empty deflate block as specified in https://www.rfc-editor.org/rfc/rfc1951.html#page-13 ,
 * which happens to be always 3, 0
 * * an adler32 checksum as specified in https://www.rfc-editor.org/rfc/rfc1950.html#page-4
 *
 * This is essentially what pako writes to the stream when invoking `deflate.push('',
 * constants.Z_FINISH)` operation after some data has been pushed with "Z_SYNC_FLUSH", but doing so
 * ends the stream and no more data can be pushed into it.
 *
 * Since we want to let the main thread end the stream synchronously at any point without needing to
 * send a message to the worker to flush it, we send back a trailer in each "wrote" response so the
 * main thread can just append it to the compressed data to end the stream.
 *
 * can merge streams together (see internal doc).
 */
function makeTrailer(deflate) {
  /* eslint-disable no-bitwise */
  var adler = deflate.strm.adler
  return new Uint8Array([
    // Empty deflate block
    3,
    0,
    // Adler32 checksum
    (adler >>> 24) & 0xff,
    (adler >>> 16) & 0xff,
    (adler >>> 8) & 0xff,
    adler & 0xff
  ])
  /* eslint-enable no-bitwise */
}
