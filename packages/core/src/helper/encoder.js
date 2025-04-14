import { computeBytesCount } from './byteUtils'

export function createIdentityEncoder() {
  var output = ''
  var outputBytesCount = 0

  return {
    isAsync: false,

    isEmpty: function () {
      return !output
    },

    write: function (data, callback) {
      var additionalEncodedBytesCount = computeBytesCount(data)
      outputBytesCount += additionalEncodedBytesCount
      output += data
      if (callback) {
        callback(additionalEncodedBytesCount)
      }
    },

    finish: function (callback) {
      callback(this.finishSync())
    },

    finishSync: function () {
      var result = {
        output: output,
        outputBytesCount: outputBytesCount,
        rawBytesCount: outputBytesCount,
        pendingData: ''
      }
      output = ''
      outputBytesCount = 0
      return result
    },

    estimateEncodedBytesCount: function (data) {
      return data.length
    }
  }
}
