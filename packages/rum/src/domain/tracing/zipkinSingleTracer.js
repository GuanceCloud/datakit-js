import { TraceIdentifier, getCrypto } from './traceIdentifier'
import { getType } from '@cloudcare/browser-core'
/**
 *
 * @param {*} configuration
 */
export function ZipkinSingleTracer(configuration, traceSampled) {
  this._traceId = new TraceIdentifier()
  this._spanId = new TraceIdentifier()
  this._traceSampled = traceSampled
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
ZipkinSingleTracer.prototype = {
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
    return this._traceId.toPaddedHexadecimalString()
  },
  getB3Str: function () {
    //{TraceId}-{SpanId}-{SamplingState}-{ParentSpanId}
    return (
      this.getTraceId() +
      '-' +
      this.getSpanId() +
      '-' +
      (this._traceSampled ? '1' : '0')
    )
  },
  makeTracingHeaders: function () {
    return {
      b3: this.getB3Str()
    }
  }
}
