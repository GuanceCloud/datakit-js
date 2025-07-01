import { TraceIdentifier, getCrypto } from './traceIdentifier'
import { getType } from '@cloudcare/browser-core'
/**
 *
 * @param {*} configuration
 */
export function ZipkinMultiTracer(configuration, traceSampled) {
  this._traceId = new TraceIdentifier()
  this._spanId = new TraceIdentifier()
  this._traceSampled = traceSampled
  this.is128Bit = configuration.traceId128Bit
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
ZipkinMultiTracer.prototype = {
  isTracingSupported: function () {
    return getCrypto() !== undefined
  },
  getSpanId: function () {
    return this._spanId.toPaddedHexadecimalString()
  },
  getTraceId: function () {
    if (this.customTraceId) {
      return this.customTraceId
    }
    return this.is128Bit
      ? '0000000000000000' + this._traceId.toPaddedHexadecimalString()
      : this._traceId.toPaddedHexadecimalString()
  },

  makeTracingHeaders: function () {
    return {
      'X-B3-TraceId': this.getTraceId(),
      'X-B3-SpanId': this.getSpanId(),
      //  'X-B3-ParentSpanId': '',
      'X-B3-Sampled': this._traceSampled ? '1' : '0'
      //  'X-B3-Flags': '0'
    }
  }
}
