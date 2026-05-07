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
export function JaegerTracer(configuration, traceSampled) {
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
JaegerTracer.prototype = {
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
  getUberTraceId: function () {
    //{trace-id}:{span-id}:{parent-span-id}:{flags}
    return (
      this.getTraceId() +
      ':' +
      this.getSpanId() +
      ':' +
      '0' +
      ':' +
      (this._traceSampled ? '1' : '0')
    )
  },
  makeTracingHeaders: function () {
    return {
      'uber-trace-id': this.getUberTraceId()
    }
  }
}
