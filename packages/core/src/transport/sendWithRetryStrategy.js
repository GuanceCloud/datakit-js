import { clocksNow, ONE_SECOND } from '../helper/tools'
import { ONE_MEBI_BYTE, ONE_KIBI_BYTE } from '../helper/byteUtils'
import { ErrorSource } from '../helper/errorTools'
import { clearTimeout, setTimeout } from '../helper/timer'
export var MAX_ONGOING_BYTES_COUNT = 80 * ONE_KIBI_BYTE
export var MAX_ONGOING_REQUESTS = 32
export var MAX_QUEUE_BYTES_COUNT = 20 * ONE_MEBI_BYTE
export var MAX_BACKOFF_TIME = 256 * ONE_SECOND
export var INITIAL_BACKOFF_TIME = ONE_SECOND
// Ordered payloads intentionally allow only one in-flight request. Without a
// watchdog, a fetch/XHR that never settles blocks the complete ordered stream
// and lets its retry queue grow until the 20 MiB cap is reached.
export var ORDERED_REQUEST_TIMEOUT = 30 * ONE_SECOND

var TransportStatus = {
  UP: 0,
  FAILURE_DETECTED: 1,
  DOWN: 2
}

var RetryReason = {
  AFTER_SUCCESS: 0,
  AFTER_RESUME: 1
}

export function sendWithRetryStrategy(
  payload,
  state,
  sendStrategy,
  endpointUrl,
  reportError
) {
  if (!isPayloadValid(payload)) {
    state.$rPayloadSequenceByPayload.delete(payload)
    return
  }
  if (!state.$rPayloadSequenceByPayload.has(payload)) {
    state.$rPayloadSequenceByPayload.set(
      payload,
      state.$rNextPayloadSequence
    )
    state.$rNextPayloadSequence += 1
  }
  if (
    state.transportStatus === TransportStatus.UP &&
    state.queuedPayloads.size() === 0 &&
    state.bandwidthMonitor.canHandle(payload)
  ) {
    send(payload, state, sendStrategy, {
      $rGeneration: state.$rRetryGeneration,
      onSuccess: function () {
        return retryQueuedPayloads(
          RetryReason.AFTER_SUCCESS,
          state,
          sendStrategy,
          endpointUrl,
          reportError
        )
      },
      onFailure: function () {
        var queued = enqueueAfterPruningInvalidPayloads(
          payload,
          state,
          !!payload.$rEnforceOrder,
          sendStrategy,
          endpointUrl,
          reportError
        )
        if (!queued) {
          state.$rPayloadSequenceByPayload.delete(payload)
          notifyPermanentDrop(payload, 'queue_full')
          resumeAfterInvalidPayloadsPruned(
            !isPayloadValid(payload) && pruneInvalidPayloads(state),
            state,
            sendStrategy,
            endpointUrl,
            reportError
          )
        }
        scheduleRetry(state, sendStrategy, endpointUrl, reportError)
      }
    })
  } else {
    if (
      !enqueueAfterPruningInvalidPayloads(
        payload,
        state,
        false,
        sendStrategy,
        endpointUrl,
        reportError
      )
    ) {
      state.$rPayloadSequenceByPayload.delete(payload)
      notifyPermanentDrop(payload, 'queue_full')
      resumeAfterInvalidPayloadsPruned(
        !isPayloadValid(payload) && pruneInvalidPayloads(state),
        state,
        sendStrategy,
        endpointUrl,
        reportError
      )
      return
    }
    // A retry timer can legitimately drain only stale generation-bound
    // payloads and leave the transport DOWN with no timer. A later valid
    // payload must restart recovery instead of remaining queued forever.
    scheduleRetry(state, sendStrategy, endpointUrl, reportError)
  }
}

function scheduleRetry(state, sendStrategy, endpointUrl, reportError) {
  if (
    state.transportStatus !== TransportStatus.DOWN ||
    state.$rRetryTimeoutId !== undefined ||
    state.queuedPayloads.size() === 0
  ) {
    return
  }
  var retryGeneration = state.$rRetryGeneration
  state.$rRetryTimeoutId = setTimeout(function () {
    state.$rRetryTimeoutId = undefined
    if (
      retryGeneration !== state.$rRetryGeneration ||
      state.transportStatus !== TransportStatus.DOWN ||
      state.queuedPayloads.size() === 0
    ) {
      return
    }
    var payload
    while (state.queuedPayloads.size() > 0) {
      payload = state.queuedPayloads.first()
      if (isPayloadValid(payload)) {
        break
      }
      state.queuedPayloads.dequeue()
      state.$rPayloadSequenceByPayload.delete(payload)
      payload = undefined
    }
    if (!payload) {
      return
    }
    send(payload, state, sendStrategy, {
      $rGeneration: retryGeneration,
      onSuccess: function () {
        state.queuedPayloads.dequeue()

        state.currentBackoffTime = INITIAL_BACKOFF_TIME
        retryQueuedPayloads(
          RetryReason.AFTER_RESUME,
          state,
          sendStrategy,
          endpointUrl,
          reportError
        )
      },
      onFailure: function () {
        state.currentBackoffTime = Math.min(
          MAX_BACKOFF_TIME,
          state.currentBackoffTime * 2
        )
        scheduleRetry(state, sendStrategy, endpointUrl, reportError)
      }
    })
  }, state.currentBackoffTime)
}

function send(payload, state, sendStrategy, responseData) {
  var onSuccess = responseData.onSuccess
  var onFailure = responseData.onFailure
  var ongoingRequest = { payload: payload, $rActive: true }
  var responseHandled = false
  state.$rOngoingRequests.add(ongoingRequest)
  state.bandwidthMonitor.add(payload)
  function handleResponse(response) {
    if (responseHandled || ongoingRequest.$rRetired) {
      return
    }
    responseHandled = true
    clearOngoingRequestWatchdog(ongoingRequest)
    state.$rOngoingRequests.delete(ongoingRequest)
    if (ongoingRequest.$rActive) {
      ongoingRequest.$rActive = false
      state.bandwidthMonitor.remove(payload)
    }
    if (responseData.$rGeneration !== state.$rRetryGeneration) {
      return
    }
    if (!shouldRetryRequest(response, state, payload)) {
      state.$rPayloadSequenceByPayload.delete(payload)
      var permanentDropReason = getPermanentDropReason(
        response,
        state,
        payload
      )
      if (permanentDropReason) {
        notifyPermanentDrop(payload, permanentDropReason)
        if (!isPayloadValid(payload)) {
          pruneInvalidPayloads(state)
        }
      }
      state.transportStatus = TransportStatus.UP
      onSuccess()
    } else {
      // do not consider transport down if another ongoing request could succeed
      state.transportStatus =
        state.bandwidthMonitor.ongoingRequestCount > 0
          ? TransportStatus.FAILURE_DETECTED
          : TransportStatus.DOWN
      payload.retry = {
        count: payload.retry ? payload.retry.count + 1 : 1,
        lastFailureStatus: response.status
      }
      onFailure()
    }
  }
  try {
    ongoingRequest.$rAbort = sendStrategy(payload, handleResponse)
    if (
      payload.$rEnforceOrder &&
      !responseHandled &&
      !ongoingRequest.$rRetired
    ) {
      ongoingRequest.$rWatchdogTimeoutId = setTimeout(function () {
        ongoingRequest.$rWatchdogTimeoutId = undefined
        if (responseHandled || ongoingRequest.$rRetired) {
          return
        }
        var abort = ongoingRequest.$rAbort
        // Settle the retry state before aborting. XHR abort can dispatch a
        // synchronous loadend with status 0, which must not turn this timeout
        // into a permanent online http_0 rejection.
        handleResponse({ status: 0, $rForceRetry: true })
        abortOngoingRequest(abort)
      }, ORDERED_REQUEST_TIMEOUT)
    }
  } catch (e) {
    handleResponse({ status: 0, $rForceRetry: true })
  }
}

function clearOngoingRequestWatchdog(ongoingRequest) {
  if (ongoingRequest.$rWatchdogTimeoutId !== undefined) {
    clearTimeout(ongoingRequest.$rWatchdogTimeoutId)
    ongoingRequest.$rWatchdogTimeoutId = undefined
  }
}

function abortOngoingRequest(abort) {
  if (!abort || typeof abort.abort !== 'function') {
    return
  }
  try {
    abort.abort()
  } catch (e) {
    // Transport cleanup must continue when cancellation is unavailable.
  }
}

function retryQueuedPayloads(
  reason,
  state,
  sendStrategy,
  endpointUrl,
  reportError
) {
  if (
    reason === RetryReason.AFTER_SUCCESS &&
    state.queuedPayloads.isFull() &&
    !state.queueFullReported
  ) {
    reportError({
      message:
        'Reached max ' +
        endpointUrl +
        ' events size queued for upload: ' +
        MAX_QUEUE_BYTES_COUNT / ONE_MEBI_BYTE +
        'MiB',
      source: ErrorSource.AGENT,
      startClocks: clocksNow()
    })
    state.queueFullReported = true
  }
  var previousQueue = state.queuedPayloads
  state.queuedPayloads = newPayloadQueue()
  while (previousQueue.size() > 0) {
    sendWithRetryStrategy(
      previousQueue.dequeue(),
      state,
      sendStrategy,
      endpointUrl,
      reportError
    )
  }
}

function shouldRetryRequest(response, state, payload) {
  if (
    state.retryMaxSize > -1 &&
    payload.retry &&
    payload.retry.count > state.retryMaxSize
  )
    return false
  return (
    response.$rForceRetry ||
    (response.type !== 'opaque' &&
      ((response.status === 0 && !navigator.onLine) ||
        response.status === 408 ||
        response.status === 429 ||
        response.status >= 500))
  )
}

function getPermanentDropReason(response, state, payload) {
  if (
    state.retryMaxSize > -1 &&
    payload.retry &&
    payload.retry.count > state.retryMaxSize
  ) {
    return 'retry_exhausted'
  }
  if (
    response.type === 'opaque' ||
    (response.status >= 200 && response.status < 300)
  ) {
    return
  }
  return 'http_' + response.status
}

function notifyPermanentDrop(payload, reason) {
  if (
    !payload ||
    payload.$rPermanentDropNotified ||
    typeof payload.$rOnPermanentDrop !== 'function'
  ) {
    return
  }
  payload.$rPermanentDropNotified = true
  try {
    payload.$rOnPermanentDrop(reason)
  } catch (e) {
    // Transport cleanup and queue progression must not depend on replay
    // recovery callbacks succeeding.
  }
}

function isPayloadValid(payload) {
  if (!payload || typeof payload.$rIsValid !== 'function') {
    return true
  }
  try {
    return payload.$rIsValid() !== false
  } catch (e) {
    return false
  }
}

function enqueueAfterPruningInvalidPayloads(
  payload,
  state,
  enqueueFirst,
  sendStrategy,
  endpointUrl,
  reportError
) {
  var enqueue = enqueueFirst ? 'enqueueFirst' : 'enqueue'
  if (state.queuedPayloads[enqueue](payload)) {
    return true
  }
  var invalidPayloadPruned = pruneInvalidPayloads(state)
  var queued = state.queuedPayloads[enqueue](payload)
  resumeAfterInvalidPayloadsPruned(
    invalidPayloadPruned,
    state,
    sendStrategy,
    endpointUrl,
    reportError
  )
  return queued
}

function pruneInvalidPayloads(state) {
  var invalidPayloadPruned = false
  var queuedPayloads = state.queuedPayloads
  var validQueuedPayloads = []
  while (queuedPayloads.size() > 0) {
    var queuedPayload = queuedPayloads.dequeue()
    if (isPayloadValid(queuedPayload)) {
      // Preserve the complete valid queue, including its permitted one-item
      // overshoot. Re-applying admission while compacting could silently drop
      // a valid tail after an ordered head crossed the byte watermark.
      validQueuedPayloads.push(queuedPayload)
    } else {
      invalidPayloadPruned = true
      state.$rPayloadSequenceByPayload.delete(queuedPayload)
    }
  }
  state.queuedPayloads = newPayloadQueue(validQueuedPayloads)

  state.$rOngoingRequests.forEach(function (ongoingRequest) {
    if (isPayloadValid(ongoingRequest.payload)) {
      return
    }
    invalidPayloadPruned = true
    ongoingRequest.$rRetired = true
    clearOngoingRequestWatchdog(ongoingRequest)
    state.$rOngoingRequests.delete(ongoingRequest)
    if (ongoingRequest.$rActive) {
      ongoingRequest.$rActive = false
      state.bandwidthMonitor.remove(ongoingRequest.payload)
    }
    state.$rPayloadSequenceByPayload.delete(ongoingRequest.payload)
    abortOngoingRequest(ongoingRequest.$rAbort)
  })
  return invalidPayloadPruned
}

function resumeAfterInvalidPayloadsPruned(
  invalidPayloadPruned,
  state,
  sendStrategy,
  endpointUrl,
  reportError
) {
  if (
    !invalidPayloadPruned ||
    state.bandwidthMonitor.ongoingRequestCount > 0
  ) {
    return
  }
  if (state.$rRetryTimeoutId !== undefined) {
    clearTimeout(state.$rRetryTimeoutId)
    state.$rRetryTimeoutId = undefined
  }
  state.transportStatus = TransportStatus.UP
  state.currentBackoffTime = INITIAL_BACKOFF_TIME
  retryQueuedPayloads(
    RetryReason.AFTER_SUCCESS,
    state,
    sendStrategy,
    endpointUrl,
    reportError
  )
}

export function newRetryState(retryMaxSize) {
  return {
    transportStatus: TransportStatus.UP,
    currentBackoffTime: INITIAL_BACKOFF_TIME,
    bandwidthMonitor: newBandwidthMonitor(),
    queuedPayloads: newPayloadQueue(),
    queueFullReported: false,
    retryMaxSize: retryMaxSize,
    $rRetryGeneration: 0,
    $rRetryTimeoutId: undefined,
    $rOngoingRequests: new Set(),
    $rPayloadSequenceByPayload: new Map(),
    $rNextPayloadSequence: 0
  }
}

export function drainQueuedPayloads(state) {
  if (state.$rRetryTimeoutId !== undefined) {
    clearTimeout(state.$rRetryTimeoutId)
    state.$rRetryTimeoutId = undefined
  }
  var queuedPayloads = state.queuedPayloads
  state.queuedPayloads = newPayloadQueue()
  var payloads = []
  var drainedPayloads = new Set()
  function appendPayload(payload) {
    if (!isPayloadValid(payload)) {
      state.$rPayloadSequenceByPayload.delete(payload)
      return
    }
    if (!drainedPayloads.has(payload)) {
      drainedPayloads.add(payload)
      payloads.push(payload)
    }
  }
  state.$rRetryGeneration += 1
  state.$rOngoingRequests.forEach(function (ongoingRequest) {
    appendPayload(ongoingRequest.payload)
    ongoingRequest.$rRetired = true
    clearOngoingRequestWatchdog(ongoingRequest)
    if (ongoingRequest.$rActive) {
      ongoingRequest.$rActive = false
      state.bandwidthMonitor.remove(ongoingRequest.payload)
      abortOngoingRequest(ongoingRequest.$rAbort)
    }
  })
  state.$rOngoingRequests.clear()
  while (queuedPayloads.size() > 0) {
    appendPayload(queuedPayloads.dequeue())
  }
  payloads.sort(function (firstPayload, secondPayload) {
    return (
      state.$rPayloadSequenceByPayload.get(firstPayload) -
      state.$rPayloadSequenceByPayload.get(secondPayload)
    )
  })
  payloads.forEach(function (payload) {
    state.$rPayloadSequenceByPayload.delete(payload)
  })
  state.transportStatus = TransportStatus.UP
  state.currentBackoffTime = INITIAL_BACKOFF_TIME
  return payloads
}

function newPayloadQueue(initialPayloads) {
  var queue = initialPayloads || []
  var head = 0
  var initialBytesCount = 0
  for (var index = 0; index < queue.length; index += 1) {
    initialBytesCount += queue[index].bytesCount
  }
  return {
    bytesCount: initialBytesCount,
    enqueue: function (payload) {
      if (this.isFull()) {
        return false
      }
      queue.push(payload)
      this.bytesCount += payload.bytesCount
      return true
    },
    enqueueFirst: function (payload) {
      if (this.isFull()) {
        return false
      }
      if (head > 0) {
        head -= 1
        queue[head] = payload
      } else {
        queue.unshift(payload)
      }
      this.bytesCount += payload.bytesCount
      return true
    },
    first: function () {
      return queue[head]
    },
    dequeue: function () {
      var payload = queue[head]
      if (payload) {
        queue[head] = undefined
        head += 1
        this.bytesCount -= payload.bytesCount
        if (head === queue.length) {
          queue = []
          head = 0
        }
      }
      return payload
    },
    size: function () {
      return queue.length - head
    },
    isFull: function () {
      return this.bytesCount >= MAX_QUEUE_BYTES_COUNT
    }
  }
}

function newBandwidthMonitor() {
  return {
    ongoingRequestCount: 0,
    ongoingOrderedRequestCount: 0,
    ongoingByteCount: 0,
    canHandle: function (payload) {
      if (
        this.ongoingOrderedRequestCount > 0 ||
        (payload.$rEnforceOrder && this.ongoingRequestCount > 0)
      ) {
        return false
      }
      return (
        this.ongoingRequestCount === 0 ||
        (this.ongoingByteCount + payload.bytesCount <=
          MAX_ONGOING_BYTES_COUNT &&
          this.ongoingRequestCount < MAX_ONGOING_REQUESTS)
      )
    },
    add: function (payload) {
      this.ongoingRequestCount += 1
      if (payload.$rEnforceOrder) {
        this.ongoingOrderedRequestCount += 1
      }
      this.ongoingByteCount += payload.bytesCount
    },
    remove: function (payload) {
      this.ongoingRequestCount -= 1
      if (payload.$rEnforceOrder) {
        this.ongoingOrderedRequestCount -= 1
      }
      this.ongoingByteCount -= payload.bytesCount
    }
  }
}
