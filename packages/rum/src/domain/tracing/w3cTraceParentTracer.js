import { TraceIdentifier, getCrypto } from './traceIdentifier'
import { assign, getType } from '@cloudcare/browser-core'

// === Generate a random 64-bit number in fixed-length hex format
function randomTraceId() {
  var digits = '0123456789abcdef'
  var n = ''
  for (var i = 0; i < 16; i += 1) {
    var rand = Math.floor(Math.random() * 16)
    n += digits[rand]
  }
  return n
}
/**
 *
 * @param {*} traceSampled
 * @param {*} isHexTraceId
 */
export function W3cTraceParentTracer(
  configuration,
  traceSampled,
  isHexTraceId
) {
  this._traceId = new TraceIdentifier()
  this._spanId = new TraceIdentifier()
  this._traceSampled = traceSampled
  this.isHexTraceId = isHexTraceId
  if (
    configuration.generateTraceId &&
    getType(configuration.generateTraceId) === 'function'
  ) {
    const customTraceId = configuration.generateTraceId()
    if (getType(customTraceId) === 'string') {
      this.customTraceId = customTraceId
    }
  }
}
W3cTraceParentTracer.prototype = {
  isTracingSupported: function () {
    return getCrypto() !== undefined
  },
  getSpanId: function () {
    return this.isHexTraceId
      ? this._spanId.toDecimalString()
      : this._spanId.toPaddedHexadecimalString()
  },
  getTraceId: function () {
    if (this.customTraceId) {
      return this.customTraceId
    }
    if (this.isHexTraceId) {
      return this._traceId.toDecimalString()
    } else {
      return (
        this._traceId.toPaddedHexadecimalString() +
        this._spanId.toPaddedHexadecimalString()
      )
    }
  },
  getTraceParent: function () {
    // '{version}-{traceId}-{spanId}-{sampleDecision}'
    if (this.isHexTraceId) {
      return (
        '00-0000000000000000' +
        this._traceId.toPaddedHexadecimalString() +
        '-' +
        this._spanId.toPaddedHexadecimalString() +
        '-' +
        (this._traceSampled ? '01' : '00')
      )
    } else {
      return (
        '00-' +
        this.getTraceId() +
        '-' +
        this.getSpanId() +
        '-' +
        (this._traceSampled ? '01' : '00')
      )
    }
  },
  makeTracingHeaders: function () {
    var baseHeaders = {
      traceparent: this.getTraceParent()
    }
    if (this.isHexTraceId) {
      return assign(baseHeaders, {
        'x-gc-trace-id': this.getTraceId(),
        'x-gc-span-id': this.getSpanId()
      })
    }
    return baseHeaders
  }
}
