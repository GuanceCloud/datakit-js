export function TraceIdentifier() {
  this.buffer = new Uint8Array(8)
  getCrypto().getRandomValues(this.buffer)
  this.buffer[0] = this.buffer[0] & 0x7f
}

TraceIdentifier.prototype = {
  // buffer: new Uint8Array(8),
  toString: function (radix) {
    var high = this.readInt32(0)
    var low = this.readInt32(4)
    var str = ''

    do {
      var mod = (high % radix) * 4294967296 + low
      high = Math.floor(high / radix)
      low = Math.floor(mod / radix)
      str = (mod % radix).toString(radix) + str
    } while (high || low)
    return str
  },
  toDecimalString: function () {
    return this.toString(10)
  },
  /**
   * Format used by OTel headers
   */
  toPaddedHexadecimalString() {
    var traceId = this.toString(16)
    return Array(17 - traceId.length).join('0') + traceId
  },
  readInt32: function (offset) {
    return (
      this.buffer[offset] * 16777216 +
      (this.buffer[offset + 1] << 16) +
      (this.buffer[offset + 2] << 8) +
      this.buffer[offset + 3]
    )
  }
}
export function getCrypto() {
  return window.crypto || window.msCrypto
}
