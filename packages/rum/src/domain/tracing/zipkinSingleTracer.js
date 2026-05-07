import {
  createRandomHexIdentifier,
  getCrypto,
  normalizeHexIdentifier
} from './traceIdentifier'
import { getType } from '@cloudcare/browser-core'
/**
 *
 * @param {*} configuration
 */
export function ZipkinSingleTracer(configuration, traceSampled) {
  this._traceId = createRandomHexIdentifier(8)
  this._spanId = createRandomHexIdentifier(8)
  this._traceSampled = traceSampled
  if (
    configuration.generateTraceId &&
    getType(configuration.generateTraceId) === 'function'
  ) {
    const customTraceId = normalizeHexIdentifier(
      configuration.generateTraceId(),
      [16, 32]
    )
    if (customTraceId) {
      this.customTraceId = customTraceId
    }
  }
}
ZipkinSingleTracer.prototype = {
  isTracingSupported: function () {
    return getCrypto() !== undefined
  },
  getSpanId: function () {
    return this._spanId
  },
  getTraceId: function () {
    if (this.customTraceId) {
      return this.customTraceId
    }
    return this._traceId
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
