import {
  drainQueuedPayloads,
  getPendingPayloadsBytesCount,
  newRetryState,
  sendWithRetryStrategy
} from './sendWithRetryStrategy'
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
    return fetchStrategyWithFallback(endpointUrl, payload, onResponse)
  }
  var sendWithRetry = function (payload) {
    sendWithRetryStrategy(
      payload,
      retryState,
      sendStrategyForRetry,
      endpointUrl,
      reportError
    )
  }

  return {
    send: sendWithRetry,
    /**
     * Since fetch keepalive behaves like regular fetch on Firefox,
     * keep using sendBeaconStrategy on exit
     */
    sendOnExit: function (payload, bytesBudget) {
      var hasBytesBudget =
        typeof bytesBudget === 'number' &&
        isFinite(bytesBudget) &&
        bytesBudget >= 0
      if (!hasBytesBudget) {
        if (
          payload.$rEnforceOrder &&
          hasPendingRetryPayloads(retryState)
        ) {
          // Hidden/frozen pages can resume. Do not let their newest replay
          // segment bypass an older ordered fetch/retry: once beaconed, that
          // dependent tail could not be withdrawn if the older segment is
          // permanently rejected later.
          sendWithRetry(payload)
          return
        }
        sendBeaconStrategy(endpointUrl, bytesLimit, payload)
        return
      }

      // Replay explicitly provides a shared unload budget. Its regular fetches
      // may have been held behind the retry strategy's bandwidth gate, so
      // promote them before the final tail while preserving their order.
      var exitPayloads = drainQueuedPayloads(retryState)
      var currentPayloadIndex = exitPayloads.indexOf(payload)
      if (currentPayloadIndex === -1) {
        currentPayloadIndex = exitPayloads.length
        exitPayloads.push(payload)
      }
      var delivery = sendPayloadsOnExit(
        endpointUrl,
        bytesLimit,
        exitPayloads,
        bytesBudget
      )

      return {
        $rBytesCount: delivery[0],
        $rCurrentPayloadSent: currentPayloadIndex < delivery[1]
      }
    },
    // Session Replay calls this explicitly on UNLOADING so retry payloads are
    // promoted even when there is no current segment to pass to sendOnExit().
    $rDrainOnExit: function (bytesBudget) {
      var hasBytesBudget =
        typeof bytesBudget === 'number' &&
        isFinite(bytesBudget) &&
        bytesBudget >= 0
      if (!hasBytesBudget) {
        return {
          $rBytesCount: 0,
          $rAllPayloadsSent: false
        }
      }

      var exitPayloads = drainQueuedPayloads(retryState)
      var delivery = sendPayloadsOnExit(
        endpointUrl,
        bytesLimit,
        exitPayloads,
        bytesBudget
      )

      return {
        $rBytesCount: delivery[0],
        $rAllPayloadsSent: delivery[1] === exitPayloads.length
      }
    },
    $rPendingBytes: function () {
      return getPendingPayloadsBytesCount(retryState)
    }
  }
}

function hasPendingRetryPayloads(retryState) {
  return (
    retryState.queuedPayloads.size() > 0 ||
    retryState.$rOngoingRequests.size > 0
  )
}

function sendPayloadsOnExit(
  endpointUrl,
  bytesLimit,
  payloads,
  bytesBudget
) {
  var sentBytesCount = 0
  var sentPayloadCount = 0
  for (; sentPayloadCount < payloads.length; sentPayloadCount += 1) {
    var payload = payloads[sentPayloadCount]
    var exitBytesCount = getExitBytesCount(payload)
    if (sentBytesCount + exitBytesCount > bytesBudget) {
      // Replay segments form an ordered dependency chain. Once an older
      // payload cannot fit, never skip it to send a later dependent tail.
      break
    }
    sendBeaconStrategy(endpointUrl, bytesLimit, payload)
    sentBytesCount += exitBytesCount
  }
  return [sentBytesCount, sentPayloadCount]
}

function getExitBytesCount(payload) {
  var bytesCount =
    payload && typeof payload.$rExitBytesCount === 'number'
      ? payload.$rExitBytesCount
      : payload && payload.bytesCount
  return typeof bytesCount === 'number' && isFinite(bytesCount)
    ? Math.max(bytesCount, 0)
    : 0
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
export function fetchStrategyWithFallback(
  endpointUrl,
  payload,
  onResponse
) {
  var url = addBatchPrecision(endpointUrl, payload.encoding)
  if (typeof fetch === 'function') {
    return sendFetch(url, payload, onResponse)
  } else {
    return sendXHR(url, payload, onResponse)
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
  return request
}
function sendFetch(url, payload, onResponse) {
  const controller =
    typeof AbortController === 'function' && new AbortController()
  const fetchOption = {
    method: 'POST',
    body: payload.data,
    mode: 'cors'
  }
  const headers = {
    'x-client-timestamp': Date.now().toString()
  }
  if (payload.type) {
    headers['Content-Type'] = payload.type
  }
  if (payload.$rKeepalive) {
    fetchOption.keepalive = true
  }
  fetchOption.headers = headers
  if (controller) {
    fetchOption.signal = controller.signal
  }

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
  if (controller) {
    return controller
  }
}
