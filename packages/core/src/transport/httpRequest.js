import { newRetryState, sendWithRetryStrategy } from './sendWithRetryStrategy'
import { addEventListener } from '../browser/addEventListener'
import { monitor } from '../helper/monitor'
import { addTelemetryError } from '../telemetry/telemetry'
/**
 * Use POST request without content type to:
 * - avoid CORS preflight requests
 * - allow usage of sendBeacon
 *
 * multiple elements are sent separated by \n in order
 * to be parsed correctly without content type header
 */
function addBatchPrecision(url, encoding) {
  if (!url) return url
  url = url + (url.indexOf('?') === -1 ? '?' : '&') + 'precision=ms'
  if (encoding) {
    url = url + '&encoding=' + encoding
  }
  return url
}
export function createHttpRequest(
  endpointUrl,
  bytesLimit,
  retryMaxSize,
  reportError
) {
  if (retryMaxSize === undefined) {
    retryMaxSize = -1
  }
  var retryState = newRetryState(retryMaxSize)
  var sendStrategyForRetry = function (payload, onResponse) {
    return fetchKeepAliveStrategy(endpointUrl, bytesLimit, payload, onResponse)
  }

  return {
    send: function (payload) {
      sendWithRetryStrategy(
        payload,
        retryState,
        sendStrategyForRetry,
        endpointUrl,
        reportError
      )
    },
    /**
     * Since fetch keepalive behaves like regular fetch on Firefox,
     * keep using sendBeaconStrategy on exit
     */
    sendOnExit: function (payload) {
      sendBeaconStrategy(endpointUrl, bytesLimit, payload)
    }
  }
}

function sendBeaconStrategy(endpointUrl, bytesLimit, payload) {
  var data = payload.data
  var bytesCount = payload.bytesCount
  var url = addBatchPrecision(endpointUrl, payload.encoding)
  var canUseBeacon = !!navigator.sendBeacon && bytesCount < bytesLimit
  if (canUseBeacon) {
    try {
      var beaconData
      if (payload.type) {
        beaconData = new Blob([data], {
          type: payload.type
        })
      } else {
        beaconData = data
      }

      var isQueued = navigator.sendBeacon(url, beaconData)

      if (isQueued) {
        return
      }
    } catch (e) {
      reportBeaconError(e)
    }
  }
  sendXHR(url, payload)
}
var hasReportedBeaconError = false

function reportBeaconError(e) {
  if (!hasReportedBeaconError) {
    hasReportedBeaconError = true
    addTelemetryError(e)
  }
}
export function fetchKeepAliveStrategy(
  endpointUrl,
  bytesLimit,
  payload,
  onResponse
) {
  var data = payload.data
  var bytesCount = payload.bytesCount
  var url = addBatchPrecision(endpointUrl, payload.encoding)
  var canUseKeepAlive = isKeepAliveSupported() && bytesCount < bytesLimit
  if (canUseKeepAlive) {
    var fetchOption = {
      method: 'POST',
      body: data,
      keepalive: true,
      mode: 'cors'
    }
    const headers = {
      'x-client-timestamp': Date.now().toString()
    }

    if (payload.type) {
      headers['Content-Type'] = payload.type
    }

    fetchOption.headers = headers
    fetch(url, fetchOption)
      .then(
        monitor(function (response) {
          if (typeof onResponse === 'function') {
            onResponse({ status: response.status, type: response.type })
          }
        })
      )
      .catch(
        monitor(function () {
          fetchStrategy(url, payload, onResponse)
        })
      )
  } else {
    sendXHR(url, payload, onResponse)
  }
}

function isKeepAliveSupported() {
  // Request can throw, cf https://developer.mozilla.org/en-US/docs/Web/API/Request/Request#errors
  try {
    return window.Request && 'keepalive' in new Request('http://a')
  } catch {
    return false
  }
}

function sendXHR(url, payload, onResponse) {
  const data = payload.data
  const request = new XMLHttpRequest()
  request.open('POST', url, true)
  if (data instanceof Blob) {
    request.setRequestHeader('Content-Type', data.type)
  } else if (payload.type) {
    request.setRequestHeader('Content-Type', payload.type)
  }
  request.setRequestHeader('x-client-timestamp', Date.now().toString())
  addEventListener(
    request,
    'loadend',
    function () {
      if (typeof onResponse === 'function') {
        onResponse({ status: request.status })
      }
    },
    {
      once: true
    }
  )
  request.send(data)
}
function fetchStrategy(url, payload, onResponse) {
  const fetchOption = {
    method: 'POST',
    body: payload.data,
    keepalive: true,
    mode: 'cors'
  }
  const headers = {
    'x-client-timestamp': Date.now().toString()
  }
  if (payload.type) {
    headers['Content-Type'] = payload.type
  }
  fetchOption.headers = headers

  fetch(url, fetchOption)
    .then(
      monitor(function (response) {
        if (typeof onResponse === 'function') {
          onResponse({ status: response.status, type: response.type })
        }
      })
    )
    .catch(
      monitor(function () {
        if (typeof onResponse === 'function') {
          onResponse({ status: 0 })
        }
      })
    )
}
