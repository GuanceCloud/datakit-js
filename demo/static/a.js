export var ONE_KIBI_BYTE = 1024
export var ONE_MEBI_BYTE = 1024 * ONE_KIBI_BYTE
// eslint-disable-next-line no-control-regex
var HAS_MULTI_BYTES_CHARACTERS = /[^\u0000-\u007F]/

export function computeBytesCount(candidate) {
  // Accurate bytes count computations can degrade performances when there is a lot of events to process
  if (!HAS_MULTI_BYTES_CHARACTERS.test(candidate)) {
    return candidate.length
  }

  if (window.TextEncoder !== undefined) {
    return new TextEncoder().encode(candidate).length
  }

  return new Blob([candidate]).size
}
export function concatBuffers(buffers) {
  var length = buffers.reduce(function (total, buffer) {
    return total + buffer.length
  }, 0)
  var result = new Uint8Array(length)
  var offset = 0
  for (var buffer of buffers) {
    result.set(buffer, offset)
    offset += buffer.length
  }
  return result
}
