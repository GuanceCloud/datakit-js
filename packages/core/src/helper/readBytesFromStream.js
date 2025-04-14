import { noop, each } from './tools'
import { monitor } from './monitor'
/**
 * Read bytes from a ReadableStream until at least `limit` bytes have been read (or until the end of
 * the stream). The callback is invoked with the at most `limit` bytes, and indicates that the limit
 * has been exceeded if more bytes were available.
 */
export function readBytesFromStream(stream, callback, options) {
  var reader = stream.getReader()
  var chunks = []
  var readBytesCount = 0

  readMore()

  function readMore() {
    reader.read().then(
      monitor(function (result) {
        if (result.done) {
          onDone()
          return
        }

        if (options.collectStreamBody) {
          chunks.push(result.value)
        }
        readBytesCount += result.value.length

        if (readBytesCount > options.bytesLimit) {
          onDone()
        } else {
          readMore()
        }
      }),
      monitor(function (error) {
        callback(error)
      })
    )
  }

  function onDone() {
    reader.cancel().catch(
      // we don't care if cancel fails, but we still need to catch the error to avoid reporting it
      // as an unhandled rejection
      noop
    )

    var bytes
    var limitExceeded
    if (options.collectStreamBody) {
      var completeBuffer
      if (chunks.length === 1) {
        // optimization: if the response is small enough to fit in a single buffer (provided by the browser), just
        // use it directly.
        completeBuffer = chunks[0]
      } else {
        // else, we need to copy buffers into a larger buffer to concatenate them.
        completeBuffer = new Uint8Array(readBytesCount)
        var offset = 0
        each(chunks, function (chunk) {
          completeBuffer.set(chunk, offset)
          offset += chunk.length
        })
      }
      bytes = completeBuffer.slice(0, options.bytesLimit)
      limitExceeded = completeBuffer.length > options.bytesLimit
    }
    callback(undefined, bytes, limitExceeded)
  }
}
