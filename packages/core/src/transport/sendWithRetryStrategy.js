import { clocksNow, ONE_SECOND } from '../helper/tools'
import { ONE_MEBI_BYTE, ONE_KIBI_BYTE } from '../helper/byteUtils'
import { ErrorSource } from '../helper/errorTools'
import { clearTimeout, setTimeout } from '../helper/timer'
export var MAX_ONGOING_BYTES_COUNT = 80 * ONE_KIBI_BYTE
export var MAX_ONGOING_REQUESTS = 32
export var MAX_QUEUE_BYTES_COUNT = 20 * ONE_MEBI_BYTE
export var MAX_BACKOFF_TIME = 256 * ONE_SECOND
export var INITIAL_BACKOFF_TIME = ONE_SECOND

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
        if (!state.queuedPayloads.enqueue(payload)) {
          state.$rPayloadSequenceByPayload.delete(payload)
        }
        scheduleRetry(state, sendStrategy, endpointUrl, reportError)
      }
    })
  } else if (!state.queuedPayloads.enqueue(payload)) {
    state.$rPayloadSequenceByPayload.delete(payload)
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
    var payload = state.queuedPayloads.first()
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
    if (responseHandled) {
      return
    }
    responseHandled = true
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
  } catch (e) {
    handleResponse({ status: 0, $rForceRetry: true })
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
    if (!drainedPayloads.has(payload)) {
      drainedPayloads.add(payload)
      payloads.push(payload)
    }
  }
  state.$rRetryGeneration += 1
  state.$rOngoingRequests.forEach(function (ongoingRequest) {
    appendPayload(ongoingRequest.payload)
    if (ongoingRequest.$rActive) {
      ongoingRequest.$rActive = false
      state.bandwidthMonitor.remove(ongoingRequest.payload)
      var abort = ongoingRequest.$rAbort
      if (abort && typeof abort.abort === 'function') {
        try {
          abort.abort()
        } catch (e) {
          // Continue promoting the remaining payloads when cancellation fails.
        }
      }
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

function newPayloadQueue() {
  var queue = []
  var head = 0
  return {
    bytesCount: 0,
    enqueue: function (payload) {
      if (this.isFull()) {
        return false
      }
      queue.push(payload)
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
    ongoingByteCount: 0,
    canHandle: function (payload) {
      return (
        this.ongoingRequestCount === 0 ||
        (this.ongoingByteCount + payload.bytesCount <=
          MAX_ONGOING_BYTES_COUNT &&
          this.ongoingRequestCount < MAX_ONGOING_REQUESTS)
      )
    },
    add: function (payload) {
      this.ongoingRequestCount += 1
      this.ongoingByteCount += payload.bytesCount
    },
    remove: function (payload) {
      this.ongoingRequestCount -= 1
      this.ongoingByteCount -= payload.bytesCount
    }
  }
}
