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
export function ZipkinMultiTracer(configuration, traceSampled) {
  this._traceId = configuration.traceId128Bit
    ? createRandomHexIdentifier(16)
    : createRandomHexIdentifier(8)
  this._spanId = createRandomHexIdentifier(8)
  this._traceSampled = traceSampled
  this.is128Bit = configuration.traceId128Bit
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
ZipkinMultiTracer.prototype = {
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
