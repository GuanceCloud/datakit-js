import { noop, throttle, requestIdleCallback } from '@cloudcare/browser-core'

/**
 * Maximum duration to wait before processing mutations. If the browser is idle, mutations will be
 * processed more quickly. If the browser is busy executing small tasks (ex: rendering frames), the
 * mutations will wait MUTATION_PROCESS_MAX_DELAY milliseconds before being processed. If the
 * browser is busy executing a longer task, mutations will be processed after this task.
 */
var MUTATION_PROCESS_MAX_DELAY = 120
export var MUTATION_PROCESS_MIN_DELAY = 48
// Keep normalization, privacy lookup, and document-order sorting bounded
// before added subtrees enter the time-sliced serializer.
export var MAX_PENDING_MUTATION_RECORDS = 256
export var MAX_PENDING_MUTATION_NODES = 1000
export var MAX_PENDING_MUTATION_APPROX_BYTES = 256 * 1024

export function createMutationBatch(processMutationBatch, onOverflow) {
  var cancelScheduledFlush = noop
  var pendingMutations = []
  var pendingMutationNodes = 0
  var pendingMutationApproxBytes = 0

  function flush() {
    cancelScheduledFlush()
    cancelScheduledFlush = noop
    if (!pendingMutations.length) {
      return
    }
    var mutationsToProcess = pendingMutations
    pendingMutations = []
    pendingMutationNodes = 0
    pendingMutationApproxBytes = 0
    try {
      processMutationBatch(mutationsToProcess)
    } catch (_) {
      if (onOverflow) {
        onOverflow({
          reason: 'mutation_processing_error',
          mutationRecordCount: mutationsToProcess.length
        })
      }
    }
  }

  function reset() {
    cancelScheduledFlush()
    cancelScheduledFlush = noop
    cancelThrottle()
    pendingMutations = []
    pendingMutationNodes = 0
    pendingMutationApproxBytes = 0
  }

  //const { throttled: throttledFlush, cancel: cancelThrottle }
  var _throttled = throttle(flush, MUTATION_PROCESS_MIN_DELAY, {
    leading: false
  })
  var throttledFlush = _throttled.throttled
  var cancelThrottle = _throttled.cancel
  return {
    addMutations: function (mutations) {
      if (!mutations.length) {
        return true
      }
      var measurements = measureMutationsUntilLimit(
        mutations,
        MAX_PENDING_MUTATION_NODES - pendingMutationNodes,
        MAX_PENDING_MUTATION_APPROX_BYTES - pendingMutationApproxBytes
      )
      if (
        pendingMutations.length + mutations.length >
          MAX_PENDING_MUTATION_RECORDS ||
        pendingMutationNodes + measurements.nodeCount >
          MAX_PENDING_MUTATION_NODES ||
        pendingMutationApproxBytes + measurements.approxBytes >
          MAX_PENDING_MUTATION_APPROX_BYTES
      ) {
        var overflow = {
          mutationRecordCount: pendingMutations.length + mutations.length,
          mutationNodeCount: pendingMutationNodes + measurements.nodeCount,
          mutationApproxBytes:
            pendingMutationApproxBytes + measurements.approxBytes
        }
        reset()
        if (onOverflow) {
          onOverflow(overflow)
        }
        return false
      }
      if (pendingMutations.length === 0) {
        cancelScheduledFlush = requestIdleCallback(throttledFlush, {
          timeout: MUTATION_PROCESS_MAX_DELAY
        })
      }
      Array.prototype.push.apply(pendingMutations, mutations)
      pendingMutationNodes += measurements.nodeCount
      pendingMutationApproxBytes += measurements.approxBytes
      return true
    },

    flush: flush,

    reset: reset,

    stop: function () {
      reset()
    }
  }
}

function measureMutationsUntilLimit(
  mutations,
  remainingNodeCapacity,
  remainingByteCapacity
) {
  var nodeCount = 0
  var approxBytes = 0
  for (var index = 0; index < mutations.length; index += 1) {
    var mutation = mutations[index]
    nodeCount += 1
    approxBytes += 32
    if (mutation.type === 'childList') {
      var childNodeCount =
        getNodeListLength(mutation.addedNodes) +
        getNodeListLength(mutation.removedNodes)
      nodeCount += childNodeCount
      approxBytes += childNodeCount * 16
    } else if (mutation.type === 'attributes') {
      approxBytes +=
        getStringApproxBytes(mutation.attributeName) +
        getStringApproxBytes(mutation.oldValue)
    } else if (mutation.type === 'characterData') {
      approxBytes += getStringApproxBytes(mutation.oldValue)
    }
    if (
      nodeCount > remainingNodeCapacity ||
      approxBytes > remainingByteCapacity
    ) {
      break
    }
  }
  return {
    nodeCount: nodeCount,
    approxBytes: approxBytes
  }
}

function getNodeListLength(nodes) {
  return nodes && typeof nodes.length === 'number' ? nodes.length : 0
}

function getStringApproxBytes(value) {
  return typeof value === 'string' ? value.length * 2 : 0
}
