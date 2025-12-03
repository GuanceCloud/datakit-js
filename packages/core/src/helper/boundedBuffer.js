import { removeItem } from './tools'
var BUFFER_LIMIT = 500
export function createBoundedBuffer() {
  var buffer = []

  var add = function (callback) {
    var length = buffer.push(callback)
    if (length > BUFFER_LIMIT) {
      buffer.splice(0, 1)
    }
  }

  var remove = function (callback) {
    removeItem(buffer, callback)
  }

  const drain = function (arg) {
    buffer.forEach(function (callback) {
      callback(arg)
    })
    buffer.length = 0
  }

  return {
    add: add,
    remove: remove,
    drain: drain
  }
}
