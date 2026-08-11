import { noop, throttle, requestIdleCallback } from '@cloudcare/browser-core'

var MUTATION_PROCESS_MAX_DELAY = 120
export var MUTATION_PROCESS_MIN_DELAY = 48
export var MAX_PENDING_MUTATION_RECORDS = 256
export var MAX_PENDING_MUTATION_NODES = 1000
export var MAX_PENDING_MUTATION_APPROX_BYTES = 256 * 1024
export var MUTATION_CHUNK_MAX_RECORDS = 64
// Keep add-heavy normalization below the operation grace used by
// mutationObserver. A wider pending batch is preserved as one transaction, but
// normalized over several bounded tasks so a short GC/renderer interruption
// cannot turn unpublished additions into mandatory FullSnapshot recovery.
export var MUTATION_CHUNK_MAX_NODES = 32
export var MUTATION_CHUNK_MAX_APPROX_BYTES = 64 * 1024
export var MAX_QUEUED_MUTATION_RECORDS = 4096
export var MAX_QUEUED_MUTATION_NODES = 16384
export var MAX_QUEUED_MUTATION_APPROX_BYTES = 8 * 1024 * 1024
var MUTATION_FLUSH_BUDGET_MS = 4

export function createMutationBatch(
  processMutationBatch,
  onOverflow,
  mutationResourceBudget
) {
  var cancelScheduledFlush = noop
  var continuationTimeout
  var pendingMutations = []
  var pendingMutationNodes = 0
  var pendingMutationApproxBytes = 0
  var pendingMutationDirectNodes = 0
  var pendingNativeCallbackCount = 0
  var pendingMutationReservations = []
  var workQueue = []
  var queuedMutationRecords = 0
  var queuedMutationNodes = 0
  var queuedMutationApproxBytes = 0
  var stopped = false
  var coalescedTextReplacementByRemovedNode = new WeakMap()

  var throttled = throttle(flush, MUTATION_PROCESS_MIN_DELAY, {
    leading: false
  })

  function scheduleInitialFlush() {
    if (cancelScheduledFlush !== noop) {
      return
    }
    cancelScheduledFlush = requestIdleCallback(throttled.throttled, {
      timeout: MUTATION_PROCESS_MAX_DELAY
    })
  }

  function scheduleContinuation() {
    if (
      continuationTimeout !== undefined ||
      stopped ||
      !workQueue.length
    ) {
      return
    }
    continuationTimeout = setTimeout(function () {
      continuationTimeout = undefined
      drainOneChunk()
      scheduleContinuation()
    }, 0)
  }

  function enqueuePending() {
    if (!pendingMutations.length) {
      return
    }
    var work = {
      $rMutations: pendingMutations,
      $rMeasurement: {
        mutationRecordCount: pendingMutations.length,
        nodeCount: pendingMutationNodes,
        approxBytes: pendingMutationApproxBytes
      },
      directNodeCount: pendingMutationDirectNodes,
      nativeCallbackCount: pendingNativeCallbackCount,
      reservations: pendingMutationReservations
    }
    enqueueMutationWork(work)
    pendingMutations = []
    pendingMutationNodes = 0
    pendingMutationApproxBytes = 0
    pendingMutationDirectNodes = 0
    pendingNativeCallbackCount = 0
    pendingMutationReservations = []
  }

  function enqueueMutationWork(work) {
    work.$rTextReplacementByRemovedNode =
      coalescedTextReplacementByRemovedNode
    if (shouldChunkMutationWork(work)) {
      initializeChunkedWork(work)
    }
    enqueueWork(work)
  }

  function enqueueWork(work) {
    workQueue.push(work)
    queuedMutationRecords += work.$rMeasurement.mutationRecordCount
    queuedMutationNodes += work.$rMeasurement.nodeCount
    queuedMutationApproxBytes += work.$rMeasurement.approxBytes
  }

  function releaseWork(work) {
    queuedMutationRecords -= work.$rMeasurement.mutationRecordCount
    queuedMutationNodes -= work.$rMeasurement.nodeCount
    queuedMutationApproxBytes -= work.$rMeasurement.approxBytes
    releaseReservations(work.reservations)
    if (!workQueue.length && !pendingMutations.length) {
      coalescedTextReplacementByRemovedNode = new WeakMap()
    }
  }

  function flush() {
    cancelScheduledFlush()
    cancelScheduledFlush = noop
    throttled.cancel()
    enqueuePending()
    var deadline = getCurrentTime() + MUTATION_FLUSH_BUDGET_MS
    var succeeded = true
    do {
      if (!drainOneChunk()) {
        succeeded = false
        break
      }
    } while (workQueue.length && getCurrentTime() < deadline)
    if (!succeeded) {
      return false
    }
    if (workQueue.length) {
      scheduleContinuation()
      return 'pending'
    }
    return true
  }

  function drainOneChunk() {
    if (stopped || !workQueue.length) {
      return true
    }
    var work = workQueue[0]
    if (work.recordIndex === undefined) {
      workQueue.shift()
      releaseWork(work)
      var batchSucceeded = process(
        work.$rMutations,
        createBatchContext(work)
      )
      if (!batchSucceeded) {
        reset()
      }
      return batchSucceeded
    }
    var chunk = takeChunk(work)
    var isLast = work.$rTransaction.$rPureAdd
      ? work.recordIndex < 0
      : work.recordIndex >= work.$rMutations.length
    var succeeded = process(
      chunk,
      createBatchContext(work, work.$rTransaction, isLast)
    )
    if (workQueue[0] !== work) {
      // Recovery callbacks may synchronously reset the whole batch. The old
      // work has already been released in that case; do not shift/release it
      // a second time or let a stale successful return escape.
      return false
    }
    if (!succeeded || isLast) {
      workQueue.shift()
      releaseWork(work)
    }
    if (!succeeded) {
      // Recovery supersedes the whole queued generation. Do not let a later
      // callback escape after the failed atomic transaction.
      reset()
    }
    return succeeded
  }

  function process(mutations, batchContext) {
    try {
      var result = processMutationBatch(mutations, batchContext)
      return batchContext.transaction
        ? result === true
        : result !== false
    } catch (_) {
      if (onOverflow) {
        onOverflow({
          reason: 'mutation_processing_error',
          mutationRecordCount: mutations.length
        })
      }
      return false
    }
  }

  function reset() {
    cancelScheduledFlush()
    cancelScheduledFlush = noop
    throttled.cancel()
    if (continuationTimeout !== undefined) {
      clearTimeout(continuationTimeout)
      continuationTimeout = undefined
    }
    releaseReservations(pendingMutationReservations)
    workQueue.forEach(function (work) {
      releaseReservations(work.reservations)
    })
    pendingMutations = []
    pendingMutationNodes = 0
    pendingMutationApproxBytes = 0
    pendingMutationDirectNodes = 0
    pendingNativeCallbackCount = 0
    pendingMutationReservations = []
    workQueue = []
    queuedMutationRecords = 0
    queuedMutationNodes = 0
    queuedMutationApproxBytes = 0
    coalescedTextReplacementByRemovedNode = new WeakMap()
  }

  return {
    addMutations: function (mutations) {
      if (!mutations.length || stopped) {
        return true
      }
      var queuedMeasurement = measureMutationsUntilLimit(
        mutations,
        MAX_QUEUED_MUTATION_NODES -
          queuedMutationNodes -
          pendingMutationNodes,
        MAX_QUEUED_MUTATION_APPROX_BYTES -
          queuedMutationApproxBytes -
          pendingMutationApproxBytes
      )
      if (
        queuedMutationRecords +
          pendingMutations.length +
          mutations.length >
          MAX_QUEUED_MUTATION_RECORDS ||
        queuedMutationNodes +
          pendingMutationNodes +
          queuedMeasurement.nodeCount >
          MAX_QUEUED_MUTATION_NODES ||
        queuedMutationApproxBytes +
          pendingMutationApproxBytes +
          queuedMeasurement.approxBytes >
          MAX_QUEUED_MUTATION_APPROX_BYTES
      ) {
        reset()
        if (onOverflow) {
          onOverflow({
            reason: 'raw_mutation_queue_watermark',
            mutationRecordCount: mutations.length,
            mutationNodeCount: queuedMeasurement.nodeCount,
            mutationApproxBytes: queuedMeasurement.approxBytes
          })
        }
        return false
      }
      var mutationResourceReservation
      if (mutationResourceBudget) {
        mutationResourceReservation = mutationResourceBudget.reserve(
          'raw',
          {
            recordCount: mutations.length,
            nodeCount: queuedMeasurement.nodeCount,
            approxBytes: queuedMeasurement.approxBytes
          }
        )
        if (!mutationResourceReservation) {
          reset()
          if (onOverflow) {
            onOverflow({
              reason: 'aggregate_raw_mutation_watermark',
              mutationRecordCount: mutations.length,
              mutationNodeCount: queuedMeasurement.nodeCount,
              mutationApproxBytes: queuedMeasurement.approxBytes
            })
          }
          return false
        }
      }
      var directNodeCount = countDirectMutationNodes(mutations)
      var canStorePending =
        !workQueue.length &&
        (!pendingMutations.length ||
          canMergePendingCallback(
            mutations.length,
            queuedMeasurement,
            directNodeCount
          ))
      if (canStorePending) {
        if (!pendingMutations.length) {
          scheduleInitialFlush()
        }
        Array.prototype.push.apply(pendingMutations, mutations)
        if (mutationResourceReservation) {
          pendingMutationReservations.push(
            mutationResourceReservation
          )
        }
        pendingMutationNodes += queuedMeasurement.nodeCount
        pendingMutationApproxBytes += queuedMeasurement.approxBytes
        pendingMutationDirectNodes += directNodeCount
        pendingNativeCallbackCount += 1
      } else {
        enqueuePending()
        enqueueMutationWork({
          $rMutations: mutations,
          $rMeasurement: {
            mutationRecordCount: mutations.length,
            nodeCount: queuedMeasurement.nodeCount,
            approxBytes: queuedMeasurement.approxBytes
          },
          directNodeCount: directNodeCount,
          nativeCallbackCount: 1,
          reservations: mutationResourceReservation
            ? [mutationResourceReservation]
            : []
        })
        scheduleContinuation()
      }
      return true
    },
    flush: flush,
    reset: reset,
    hasPending: function () {
      return Boolean(pendingMutations.length || workQueue.length)
    },
    stop: function () {
      stopped = true
      reset()
    }
  }

  function canMergePendingCallback(
    mutationRecordCount,
    measurement,
    directNodeCount
  ) {
    return (
      pendingMutationDirectNodes + directNodeCount <=
        MUTATION_CHUNK_MAX_NODES &&
      pendingMutations.length + mutationRecordCount <=
        MAX_PENDING_MUTATION_RECORDS &&
      pendingMutationNodes + measurement.nodeCount <=
        MAX_PENDING_MUTATION_NODES &&
      pendingMutationApproxBytes + measurement.approxBytes <=
        MAX_PENDING_MUTATION_APPROX_BYTES
    )
  }
}

function initializeChunkedWork(work) {
  var isPureAdd =
    work.nativeCallbackCount === 1 &&
    isReverseChunkableSiblingAddWork(work.$rMutations)
  work.$rTransaction = {
    $rPureAdd: isPureAdd,
    $rHasUnchunkableStructuralMutation:
      !isPureAdd && hasUnchunkableStructuralMutation(work.$rMutations),
    $rMutationRecordCount: work.$rMeasurement.mutationRecordCount
  }
  work.recordIndex = isPureAdd ? work.$rMutations.length - 1 : 0
  work.addedIndex = isPureAdd
    ? getNodeListLength(work.$rMutations[work.recordIndex].addedNodes)
    : 0
  work.removedIndex = 0
}

function createBatchContext(work, transaction, isLast) {
  return {
    transaction: transaction,
    isLast: isLast,
    $rTextReplacementByRemovedNode:
      work.$rTextReplacementByRemovedNode
  }
}

function hasStructuralRemoval(mutations) {
  for (var index = 0; index < mutations.length; index += 1) {
    if (
      mutations[index].type === 'childList' &&
      getNodeListLength(mutations[index].removedNodes)
    ) {
      return true
    }
  }
  return false
}

function hasUnchunkableStructuralMutation(mutations) {
  for (var index = 0; index < mutations.length; index += 1) {
    var mutation = mutations[index]
    if (
      mutation.type === 'childList' &&
      getNodeListLength(mutation.removedNodes) &&
      getNodeListLength(mutation.addedNodes) +
        getNodeListLength(mutation.removedNodes) >=
        MAX_PENDING_MUTATION_NODES
    ) {
      return true
    }
  }
  return false
}

function shouldChunkMutationWork(work) {
  return (
    (work.nativeCallbackCount === 1 &&
      work.directNodeCount >= MUTATION_CHUNK_MAX_NODES &&
      !hasStructuralRemoval(work.$rMutations)) ||
    work.$rMeasurement.mutationRecordCount >
      MAX_PENDING_MUTATION_RECORDS ||
    work.$rMeasurement.nodeCount > MAX_PENDING_MUTATION_NODES ||
    work.$rMeasurement.approxBytes > MAX_PENDING_MUTATION_APPROX_BYTES
  )
}

function isReverseChunkableSiblingAddWork(mutations) {
  var hasAdd = false
  var target
  var addedNodeSet = new Set()
  var previousAddedNode
  for (var index = 0; index < mutations.length; index += 1) {
    var mutation = mutations[index]
    if (
      mutation.type !== 'childList' ||
      getNodeListLength(mutation.removedNodes)
    ) {
      return false
    }
    if (target === undefined) {
      target = mutation.target
    } else if (mutation.target !== target) {
      return false
    }
    for (
      var addedIndex = 0;
      addedIndex < getNodeListLength(mutation.addedNodes);
      addedIndex += 1
    ) {
      var addedNode = mutation.addedNodes[addedIndex]
      if (
        !target ||
        addedNodeSet.has(addedNode) ||
        addedNode.parentNode !== target ||
        (previousAddedNode &&
          !isFollowingSibling(previousAddedNode, addedNode))
      ) {
        return false
      }
      addedNodeSet.add(addedNode)
      previousAddedNode = addedNode
      hasAdd = true
    }
  }
  return hasAdd
}

function isFollowingSibling(previousNode, node) {
  if (typeof previousNode.compareDocumentPosition !== 'function') {
    return false
  }
  /* eslint-disable no-bitwise */
  return Boolean(
    previousNode.compareDocumentPosition(node) &
      Node.DOCUMENT_POSITION_FOLLOWING
  )
  /* eslint-enable no-bitwise */
}

function countDirectMutationNodes(mutations) {
  var nodeCount = 0
  for (var index = 0; index < mutations.length; index += 1) {
    var mutation = mutations[index]
    if (mutation.type === 'childList') {
      nodeCount +=
        getNodeListLength(mutation.addedNodes) +
        getNodeListLength(mutation.removedNodes)
    }
  }
  return nodeCount
}

function releaseReservations(reservations) {
  if (!reservations) {
    return
  }
  reservations.forEach(function (release) {
    release()
  })
  reservations.length = 0
}

function takeChunk(work) {
  if (work.$rTransaction.$rPureAdd) {
    return takePureAddChunk(work)
  }
  var chunk = []
  var nodeCount = 0
  var approxBytes = 0
  while (
    work.recordIndex < work.$rMutations.length &&
    chunk.length < MUTATION_CHUNK_MAX_RECORDS
  ) {
    var mutation = work.$rMutations[work.recordIndex]
    var synthetic = mutation
    var isChildList = mutation.type === 'childList'
    var nextAddedIndex = work.addedIndex
    var nextRemovedIndex = work.removedIndex
    var completesChildList = false
    if (mutation.type === 'childList') {
      var addedNodeCount = getNodeListLength(mutation.addedNodes)
      var removedNodeCount = getNodeListLength(mutation.removedNodes)
      var keepStructuralMutationWhole =
        removedNodeCount > 0 &&
        addedNodeCount + removedNodeCount < MAX_PENDING_MUTATION_NODES
      if (keepStructuralMutationWhole) {
        var structuralMeasurement = measureMutation(mutation)
        if (
          chunk.length &&
          (nodeCount + structuralMeasurement.nodeCount >
            MUTATION_CHUNK_MAX_NODES ||
            approxBytes + structuralMeasurement.approxBytes >
              MUTATION_CHUNK_MAX_APPROX_BYTES)
        ) {
          // A remove/add pair is one replay-tree transition. If it cannot fit
          // at the tail of this chunk, move the complete native record to the
          // next chunk instead of splitting the two structural sides.
          break
        }
        synthetic = {
          type: 'childList',
          target: mutation.target,
          addedNodes: Array.prototype.slice.call(mutation.addedNodes),
          removedNodes: Array.prototype.slice.call(mutation.removedNodes),
          previousSibling: mutation.previousSibling,
          nextSibling: mutation.nextSibling
        }
        nextAddedIndex = addedNodeCount
        nextRemovedIndex = removedNodeCount
        completesChildList = true
      } else {
        var remainingNodes = Math.max(
          Math.min(
            MUTATION_CHUNK_MAX_NODES - nodeCount - 1,
            Math.floor(
              (MUTATION_CHUNK_MAX_APPROX_BYTES -
                approxBytes -
                32) /
                16
            )
          ),
          1
        )
        var addedNodes = Array.prototype.slice.call(
          mutation.addedNodes,
          work.addedIndex,
          work.addedIndex + remainingNodes
        )
        remainingNodes -= addedNodes.length
        var removedNodes = Array.prototype.slice.call(
          mutation.removedNodes,
          work.removedIndex,
          work.removedIndex + remainingNodes
        )
        synthetic = {
          type: 'childList',
          target: mutation.target,
          addedNodes: addedNodes,
          removedNodes: removedNodes,
          previousSibling: mutation.previousSibling,
          nextSibling: mutation.nextSibling
        }
        nextAddedIndex += addedNodes.length
        nextRemovedIndex += removedNodes.length
        completesChildList =
          nextAddedIndex >= addedNodeCount &&
          nextRemovedIndex >= removedNodeCount
      }
    } else {
      synthetic = cloneMutationRecord(mutation)
      work.recordIndex += 1
    }
    var measurement = measureMutation(synthetic)
    if (
      chunk.length &&
      (nodeCount + measurement.nodeCount > MUTATION_CHUNK_MAX_NODES ||
        approxBytes + measurement.approxBytes >
          MUTATION_CHUNK_MAX_APPROX_BYTES)
    ) {
      // The cursor is committed only after the synthetic record fits. This is
      // important at an exact boundary: advancing a child-list cursor before
      // this check would silently drop the rejected slice.
      if (!isChildList) {
        work.recordIndex -= 1
      }
      break
    }
    if (isChildList) {
      if (completesChildList) {
        work.recordIndex += 1
        work.addedIndex = 0
        work.removedIndex = 0
      } else {
        work.addedIndex = nextAddedIndex
        work.removedIndex = nextRemovedIndex
      }
    }
    chunk.push(synthetic)
    nodeCount += measurement.nodeCount
    approxBytes += measurement.approxBytes
    if (
      nodeCount >= MUTATION_CHUNK_MAX_NODES ||
      approxBytes >= MUTATION_CHUNK_MAX_APPROX_BYTES
    ) {
      break
    }
  }
  return chunk
}

function takePureAddChunk(work) {
  var chunk = []
  var nodeCount = 0
  var approxBytes = 0
  while (
    work.recordIndex >= 0 &&
    chunk.length < MUTATION_CHUNK_MAX_RECORDS
  ) {
    while (work.recordIndex >= 0 && work.addedIndex === 0) {
      work.recordIndex -= 1
      work.addedIndex =
        work.recordIndex >= 0
          ? getNodeListLength(
              work.$rMutations[work.recordIndex].addedNodes
            )
          : 0
    }
    if (work.recordIndex < 0) {
      break
    }

    var mutation = work.$rMutations[work.recordIndex]
    var remainingNodes = Math.max(
      Math.min(
        MUTATION_CHUNK_MAX_NODES - nodeCount - 1,
        Math.floor(
          (MUTATION_CHUNK_MAX_APPROX_BYTES - approxBytes - 32) /
            16
        )
      ),
      1
    )
    var sliceStart = Math.max(
      work.addedIndex - remainingNodes,
      0
    )
    var synthetic = {
      type: 'childList',
      target: mutation.target,
      addedNodes: Array.prototype.slice.call(
        mutation.addedNodes,
        sliceStart,
        work.addedIndex
      ),
      removedNodes: []
    }
    var measurement = measureMutation(synthetic)
    if (
      chunk.length &&
      (nodeCount + measurement.nodeCount > MUTATION_CHUNK_MAX_NODES ||
        approxBytes + measurement.approxBytes >
          MUTATION_CHUNK_MAX_APPROX_BYTES)
    ) {
      break
    }

    work.addedIndex = sliceStart
    if (work.addedIndex === 0) {
      work.recordIndex -= 1
      work.addedIndex =
        work.recordIndex >= 0
          ? getNodeListLength(
              work.$rMutations[work.recordIndex].addedNodes
            )
          : 0
    }
    chunk.push(synthetic)
    nodeCount += measurement.nodeCount
    approxBytes += measurement.approxBytes
    if (
      nodeCount >= MUTATION_CHUNK_MAX_NODES ||
      approxBytes >= MUTATION_CHUNK_MAX_APPROX_BYTES
    ) {
      break
    }
  }
  return chunk
}

function cloneMutationRecord(mutation) {
  var oldValue = mutation.oldValue
  if (
    typeof oldValue === 'string' &&
    oldValue.length > MUTATION_CHUNK_MAX_APPROX_BYTES / 4
  ) {
    oldValue = undefined
  }
  return {
    type: mutation.type,
    target: mutation.target,
    attributeName: mutation.attributeName,
    oldValue: oldValue
  }
}

function measureMutationsUntilLimit(mutations, nodeLimit, byteLimit) {
  var nodeCount = 0
  var approxBytes = 0
  for (var index = 0; index < mutations.length; index += 1) {
    var measurement = measureMutation(mutations[index])
    nodeCount += measurement.nodeCount
    approxBytes += measurement.approxBytes
    if (nodeCount > nodeLimit || approxBytes > byteLimit) {
      break
    }
  }
  return { nodeCount: nodeCount, approxBytes: approxBytes }
}

function measureMutation(mutation) {
  var nodeCount = 1
  var approxBytes = 32
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
  return { nodeCount: nodeCount, approxBytes: approxBytes }
}

function getNodeListLength(nodes) {
  return nodes && typeof nodes.length === 'number' ? nodes.length : 0
}

function getStringApproxBytes(value) {
  return typeof value === 'string' ? value.length * 2 : 0
}

function getCurrentTime() {
  return typeof performance !== 'undefined' && performance.now
    ? performance.now()
    : Date.now()
}
