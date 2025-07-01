import { TraceIdentifier, getCrypto } from './traceIdentifier'
import { getType } from '@cloudcare/browser-core'
/**
 *
 * @param {*} configuration
 */
export function DDtraceTracer(configuration, traceSampled) {
  this._spanId = new TraceIdentifier()
  this._traceId = new TraceIdentifier()
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
DDtraceTracer.prototype = {
  isTracingSupported: function () {
    return getCrypto() !== undefined
  },
  getSpanId: function () {
    return this._spanId.toDecimalString()
  },
  getTraceId: function () {
    if (this.customTraceId) {
      return this.customTraceId
    }
    return this._traceId.toDecimalString()
  },
  makeTracingHeaders: function () {
    return {
      'x-datadog-origin': 'rum',
      'x-datadog-parent-id': this.getSpanId(),
      'x-datadog-sampling-priority': this._traceSampled ? '2' : '-1',
      'x-datadog-trace-id': this.getTraceId()
    }
  }
}
