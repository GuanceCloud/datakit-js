import { base64Encode, urlParse, getType } from '@cloudcare/browser-core'
// start SkyWalking
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    /* tslint:disable */
    var r = (Math.random() * 16) | 0
    /* tslint:disable */
    var v = c === 'x' ? r : (r & 0x3) | 0x8

    return v.toString(16)
  })
}
/**
 *
 * @param {*} traceId
 * @param {*} traceSegmentId
 * @param {*} applicationId
 * @param {*} version
 * @param {*} requestUrlHost
 */
function getSkyWalkingSw8(
  traceId,
  traceSegmentId,
  applicationId,
  env,
  version,
  requestUrlHost
) {
  try {
    var traceIdStr = String(base64Encode(traceId))
    var segmentId = String(base64Encode(traceSegmentId))
    var service = String(base64Encode(applicationId + '_rum_' + env))
    var instance = String(base64Encode(version))
    var endpoint = String(base64Encode(window.location.href))
    var peer = String(base64Encode(requestUrlHost))
    var index = '0'
    // var values = `${1}-${traceIdStr}-${segmentId}-${index}-${service}-${instance}-${endpoint}-${peer}`;
    return (
      '1-' +
      traceIdStr +
      '-' +
      segmentId +
      '-' +
      index +
      '-' +
      service +
      '-' +
      instance +
      '-' +
      endpoint +
      '-' +
      peer
    )
  } catch (err) {
    return ''
  }
}
/**
 *
 * @param {*} configuration
 * @param {*} requestUrl
 */
export function SkyWalkingTracer(configuration, requestUrl, traceSampled) {
  this._spanId = uuid()
  this._traceId = uuid()
  this._applicationId = configuration.applicationId
  this._env = configuration.env
  this._version = configuration.version
  this._urlParse = urlParse(requestUrl).getParse()
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
SkyWalkingTracer.prototype = {
  isTracingSupported: function () {
    if (this._env && this._version && this._urlParse) return true
    return false
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
  getSkyWalkingSw8: function () {
    try {
      var traceIdStr = String(base64Encode(this.getTraceId()))
      var segmentId = String(base64Encode(this.getSpanId()))
      var service = String(
        base64Encode(this._applicationId + '_rum_' + this.env)
      )
      var instance = String(base64Encode(this._version))
      var endpoint = String(base64Encode(window.location.href))
      var peer = String(base64Encode(this._urlParse.Host))
      var index = '0'
      // var values = `${1}-${traceIdStr}-${segmentId}-${index}-${service}-${instance}-${endpoint}-${peer}`;
      return (
        (this._traceSampled ? '1' : '0') +
        '-' +
        traceIdStr +
        '-' +
        segmentId +
        '-' +
        index +
        '-' +
        service +
        '-' +
        instance +
        '-' +
        endpoint +
        '-' +
        peer
      )
    } catch (err) {
      return ''
    }
  },
  makeTracingHeaders: function () {
    return {
      sw8: this.getSkyWalkingSw8()
    }
  }
}
