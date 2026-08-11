import {
  noop,
  isNodeShadowHost,
  getParentNode,
  isNullUndefinedDefaultValue,
  monitor,
  assign
} from '@cloudcare/browser-core'
import { getMutationObserverConstructor } from '../../domMutationObservable'
import { NodePrivacyLevel } from '../../../constants'
import { getNodePrivacyLevel, getTextContent } from './privacy'
import {
  getElementInputValue,
  getSerializedNodeId,
  hasSerializedNode,
  MAX_SERIALIZED_NODE_ANCESTOR_DEPTH,
  nodeAndAncestorsHaveSerializedNode
} from './serializationUtils'
import {
  serializeNodeWithId,
  createMutationSerializerTask,
  serializeAttribute,
  truncateSerializedValue,
  SERIALIZATION_MAX_MUTATION_SOURCE_LENGTH,
  SerializationContextStatus
} from './serialize'
import {
  createMutationBatch,
  MAX_QUEUED_MUTATION_NODES
} from './mutationBatch'
import { MUTATION_RESOURCE_RETAINED } from './mutationResourceBudget'

var MUTATION_SERIALIZATION_SLICE_MS = 4
var MUTATION_SERIALIZATION_FLUSH_BUDGET_MS = 4
export var MUTATION_NORMALIZATION_MAX_DURATION_MS = 4
var MUTATION_NORMALIZATION_TIME_CHECK_INTERVAL = 32
// performance.now() can jump across a short GC pause or an interrupted
// observer callback. Let a small, raw-batch-bounded amount of normalization
// finish before treating the wall-clock deadline as structural loss.
var MUTATION_NORMALIZATION_SMALL_BATCH_MAX_RECORDS = 32
var MUTATION_NORMALIZATION_MIN_OPERATIONS_BEFORE_TIMEOUT = 256
var MUTATION_NORMALIZATION_ABORT = {}
// A serialized add cannot be split below its root.  Stop before building one
// that would exceed record.js' single mutation emit watermark.
var MUTATION_SERIALIZATION_MAX_NODE_COUNT = 5000
var MUTATION_SERIALIZATION_MAX_APPROX_BYTES = 200000
export var MAX_PENDING_MUTATION_ROOT_TASKS = 256
// Keep the expensive serializer state bounded while allowing a large burst of
// unpublished, add-only roots to wait as lightweight DOM references.  The
// deferred queue is intentionally finite and matches the raw node watermark:
// one accepted native callback can therefore be drained without dropping a
// root, while a sustained producer still cannot grow the queue without bound.
export var MAX_DEFERRED_MUTATION_ROOT_TASKS =
  MAX_QUEUED_MUTATION_NODES
var DEFERRED_MUTATION_ROOT_TASK_APPROX_BYTES = 128
export var MAX_PENDING_MUTATION_GROUPS = 256
export var MAX_PENDING_MUTATION_ROOT_APPROX_BYTES = 4 * 1024 * 1024
export var MAX_MUTATION_ROOT_TASK_REFRESH_COUNT = 16
export var MAX_REMOVED_SUBTREE_TRAVERSAL_NODES = 5000
// MutationBatch can only account for MutationRecord.oldValue. Bound the
// current text/attribute values separately before privacy transforms and
// record-size estimation scan them synchronously.
export var MAX_MUTATION_CURRENT_SOURCE_CHARACTERS = 512 * 1024
export var MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS =
  SERIALIZATION_MAX_MUTATION_SOURCE_LENGTH
var AGGREGATE_RETAINED_MUTATION_WATERMARK =
  'aggregate_retained_mutation_watermark'
var MUTATION_ROOT_ADMISSION_WATERMARK =
  'mutation_root_admission_watermark'
var MUTATION_ROOT_RETAINED_BYTES_WATERMARK =
  'mutation_root_retained_bytes_watermark'
var MAX_REMOVED_SUBTREE_TRAVERSAL_DURATION_MS = 4
var REMOVED_SUBTREE_TIME_CHECK_INTERVAL = 32
var publicationTokenByMutationAdd = new WeakMap()
var sourceNodeByMutationRemove = new WeakMap()
var approxBytesByMutationPayload = new WeakMap()

export function getMutationPayloadApproxBytes(payload) {
  var trackedApproxBytes = approxBytesByMutationPayload.get(payload)
  if (trackedApproxBytes) {
    return trackedApproxBytes
  }
  return estimateFallbackMutationPayloadApproxBytes(payload)
}

function estimateFallbackMutationPayloadApproxBytes(payload) {
  if (!payload) {
    return 64
  }
  return (
    64 +
    (payload.adds || []).length * 64 +
    estimateMutationPayloadEntriesApproxBytes(payload)
  )
}

function estimateMutationPayloadEntriesApproxBytes(payload) {
  var approxBytes = (payload.removes || []).length * 24
  ;(payload.texts || []).forEach(function (text) {
    approxBytes += 24 + getMutationPayloadStringApproxBytes(text.value)
  })
  ;(payload.attributes || []).forEach(function (attribute) {
    approxBytes += 24
    Object.keys(attribute.attributes || {}).forEach(function (name) {
      approxBytes +=
        getMutationPayloadStringApproxBytes(name) +
        getMutationPayloadStringApproxBytes(attribute.attributes[name])
    })
  })
  return approxBytes
}

function getMutationPayloadStringApproxBytes(value) {
  return typeof value === 'string' ? value.length * 2 : 0
}

function getMutationDependencyState(shadowRootsController) {
  if (!shadowRootsController) {
    return
  }
  if (!shadowRootsController.$rMutationDependencyState) {
    shadowRootsController.$rMutationDependencyState = {
      $rPublishedRoots: new WeakSet(),
      $rLocallyDroppedRoots: new WeakSet()
    }
  }
  return shadowRootsController.$rMutationDependencyState
}

export function consumeMutationAddPublicationToken(add) {
  var publicationToken = publicationTokenByMutationAdd.get(add)
  publicationTokenByMutationAdd.delete(add)
  return publicationToken
}

export function getMutationAddPublicationToken(add) {
  return publicationTokenByMutationAdd.get(add)
}

export function registerMutationAddPublicationToken(add, publicationToken) {
  publicationTokenByMutationAdd.set(add, publicationToken)
}

export function createMutationAddPublicationToken(
  shadowRootsController,
  requiresBaselineOnDrop
) {
  return {
    $rPublished: false,
    $rQueued: false,
    $rCanceled: false,
    $rRequiresBaselineOnDrop: Boolean(requiresBaselineOnDrop),
    $rShadowRootsController: shadowRootsController
  }
}

export function publishMutationAddPublicationToken(publicationToken) {
  if (!publicationToken || publicationToken.$rCanceled) {
    return
  }
  publicationToken.$rQueued = false
  publicationToken.$rPublished = true
  var shadowRootsController = publicationToken.$rShadowRootsController
  if (
    shadowRootsController &&
    shadowRootsController.commitProvisionalShadowRoots
  ) {
    shadowRootsController.commitProvisionalShadowRoots(publicationToken)
  }
  publicationToken.$rShadowRootsController = undefined
}

export function cancelMutationAddPublicationToken(publicationToken) {
  if (
    !publicationToken ||
    publicationToken.$rPublished ||
    publicationToken.$rCanceled
  ) {
    return
  }
  publicationToken.$rQueued = false
  publicationToken.$rCanceled = true
  var shadowRootsController = publicationToken.$rShadowRootsController
  if (
    shadowRootsController &&
    shadowRootsController.rollbackProvisionalShadowRoots
  ) {
    shadowRootsController.rollbackProvisionalShadowRoots(publicationToken)
  }
  publicationToken.$rShadowRootsController = undefined
}

export function consumeMutationRemoveSourceNode(remove) {
  var sourceNode = sourceNodeByMutationRemove.get(remove)
  sourceNodeByMutationRemove.delete(remove)
  return sourceNode
}

export function getMutationRemoveSourceNode(remove) {
  return sourceNodeByMutationRemove.get(remove)
}

/**
 * Buffers and aggregate mutations generated by a MutationObserver into MutationPayload
 */
export function startMutationObserver(
  mutationCallback,
  configuration,
  shadowRootsController,
  target,
  mutationPerfCb,
  mutationOverflowCb,
  mutationActivityCb,
  mutationNodeSerializationCb,
  isNodeIgnored,
  isNodePublished,
  isSourceActive,
  mutationResourceBudget
) {
  var MutationObserver = getMutationObserverConstructor()
  if (!MutationObserver) {
    return { stop: noop, flush: noop, reset: noop, deactivate: noop }
  }
  var active = true
  var isObserverActive = function () {
    return active && (!isSourceActive || isSourceActive())
  }

  var mutationTasksController = createMutationTasksController(
    mutationCallback,
    configuration,
    shadowRootsController,
    mutationPerfCb,
    mutationOverflowCb,
    mutationNodeSerializationCb,
    isNodeIgnored,
    mutationResourceBudget
  )

  var mutationBatch = createMutationBatch(function (
    mutations,
    mutationBatchContext
  ) {
    if (!isObserverActive()) {
      return
    }
    var processStart = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? getCurrentTime()
      : 0
    var overflowCountBeforeProcess =
      mutationTasksController.getOverflowCount()
    var processed = processMutations(
      mutations,
      mutationCallback,
      configuration,
      shadowRootsController,
      mutationTasksController,
      isNodeIgnored,
      isNodePublished,
      mutationBatchContext
    )
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && mutationPerfCb) {
      mutationPerfCb({
        processMutationsCount: 1,
        processMutationsDuration: getCurrentTime() - processStart
      })
    }
    return mutationTasksController.getOverflowCount() ===
      overflowCountBeforeProcess
      ? processed
      : false
  }, function (overflow) {
    if (!active) {
      return
    }
    observer.takeRecords()
    mutationTasksController.reset()
    reportMutationOverflow({
      reason: overflow.reason || 'raw_mutation_watermark',
      mutationRecordCount: overflow.mutationRecordCount,
      mutationNodeCount: overflow.mutationNodeCount,
      mutationApproxBytes: overflow.mutationApproxBytes
    })
  }, mutationResourceBudget)

  var observer = new MutationObserver(
    monitor(function (mutations) {
      if (!isObserverActive()) {
        return
      }
      notifyMutationActivity(mutations)
      mutationBatch.addMutations(mutations)
    })
  )
  try {
    observer.observe(target, {
      attributeOldValue: true,
      attributes: true,
      characterData: true,
      characterDataOldValue: true,
      childList: true,
      subtree: true
    })
  } catch (err) {}

  return {
    stop: function () {
      active = false
      observer.disconnect()
      mutationBatch.stop()
      mutationTasksController.stop()
    },
    deactivate: function () {
      // Shadow-root generation cleanup is deliberately sliced. Stop native
      // callbacks and release queued records/serializer tasks immediately,
      // while leaving the physical disconnect and listener cleanup to stop().
      //
      // Do not mark the task controller as stopped here. A removed-subtree
      // overflow can retire its shadow generation from inside processMutations
      // and must still deliver the paired overflow callback after reset().
      active = false
      mutationBatch.reset()
      mutationTasksController.reset()
    },
    refreshAndFlushPendingRootForNode: function (node) {
      if (!isObserverActive()) {
        return
      }
      // A common attachShadow() pattern appends the host and attaches the root
      // in the same JavaScript turn, before the native MutationObserver
      // callback runs. Materialize those queued host records first so the
      // targeted pending-root lookup also covers that synchronous window.
      var pendingRecords = observer.takeRecords()
      notifyMutationActivity(pendingRecords)
      if (!mutationBatch.addMutations(pendingRecords)) {
        return false
      }
      var batchFlushResult = mutationBatch.flush()
      if (batchFlushResult === false) {
        // A normalization overflow is reported from inside the batch
        // processor. The batch drops its queued generation, but the task
        // controller must also leave its overflowed state so a later DOM
        // change can be recorded after recovery, matching the pre-slicing
        // observer lifecycle.
        mutationTasksController.reset()
      }
      if (batchFlushResult !== true) {
        return batchFlushResult
      }
      return mutationTasksController.refreshAndFlushPendingRootForNode(
        node
      )
    },
    flush: function () {
      if (!isObserverActive()) {
        return true
      }
      var pendingRecords = observer.takeRecords()
      notifyMutationActivity(pendingRecords)
      if (!mutationBatch.addMutations(pendingRecords)) {
        return false
      }
      var overflowCountBeforeFlush =
        mutationTasksController.getOverflowCount()
      var batchFlushResult = mutationBatch.flush()
      if (batchFlushResult === false) {
        // processMutations may fail the task controller while mutationBatch
        // is draining a transaction. Reset both halves of the pipeline; an
        // otherwise sticky overflow would silently drop every later change.
        mutationTasksController.reset()
      }
      if (batchFlushResult !== true) {
        return batchFlushResult
      }
      var taskFlushResult = mutationTasksController.flush()
      if (taskFlushResult === 'pending') {
        return 'pending'
      }
      if (taskFlushResult === false) {
        var overflowAlreadyReported =
          mutationTasksController.getOverflowCount() >
          overflowCountBeforeFlush
        mutationTasksController.reset()
        if (!overflowAlreadyReported) {
          reportMutationOverflow({
            reason: 'serialization_budget'
          })
        }
        return false
      }
      return true
    },
    reset: function () {
      if (!isObserverActive()) {
        return
      }
      // Drop records queued by the native observer before resetting the
      // time-sliced serializer. Otherwise they may be delivered after a full
      // snapshot and replay stale mutations on top of the new DOM baseline.
      notifyMutationActivity(observer.takeRecords())
      if (mutationBatch.reset) {
        mutationBatch.reset()
      }
      mutationTasksController.reset()
    }
  }

  function notifyMutationActivity(mutations) {
    if (mutations.length && mutationActivityCb) {
      mutationActivityCb(target)
    }
  }

  function reportMutationOverflow(overflow) {
    if (
      mutationResourceBudget &&
      !mutationResourceBudget.failOnce()
    ) {
      return
    }
    if (mutationOverflowCb) {
      mutationOverflowCb(overflow)
    }
  }
}

export function processMutations(
  mutations,
  mutationCallback,
  configuration,
  shadowRootsController,
  mutationTasksController,
  isNodeIgnored,
  isNodePublished,
  mutationBatchContext
) {
  isNodeIgnored = isNodeIgnored || function () {
    return false
  }
  isNodePublished = isNodePublished || hasSerializedNode
  if (mutationTasksController.isOverflowed()) {
    return
  }
  var transactionState =
    mutationBatchContext && mutationBatchContext.transaction
  if (
    transactionState &&
    transactionState.$rHasUnchunkableStructuralMutation
  ) {
    transactionState.$rFailed = true
    mutationTasksController.handleOverflow({
      reason: 'mutation_normalization_budget',
      mutationRecordCount: transactionState.$rMutationRecordCount
    })
    return false
  }
  var nodePrivacyLevelCache = new Map()
  var pendingRootTasksToRefresh = new Set()
  var childListMutations = []
  var characterDataMutations = []
  var attributeMutations = []
  var disconnectedShadowRootsCleaned = false
  var removedSubtreeTraversalState = {
    deadline: undefined,
    nodeCount: 0
  }
  var normalizationState = {
    deadline:
      getCurrentTime() + MUTATION_NORMALIZATION_MAX_DURATION_MS,
    exhausted: false,
    mutationTasksController: mutationTasksController,
    mutationRecordCount: mutations.length,
    timeCheckCount: 0
  }
  var currentSourceState
  if (transactionState) {
    currentSourceState = transactionState.$rCurrentSourceState
    if (!currentSourceState) {
      currentSourceState = { characters: 0 }
      transactionState.$rCurrentSourceState = currentSourceState
    }
  } else {
    currentSourceState = { characters: 0 }
  }

  for (var _i = 0, mutations_1 = mutations; _i < mutations_1.length; _i++) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      cancelNormalizedMutationGroup(
        mutationTasksController,
        mutationGroup
      )
      return
    }
    var mutation = mutations_1[_i]
    if (
      mutation.type === 'childList' &&
      mutation.removedNodes.length
    ) {
      if (
        !disconnectedShadowRootsCleaned &&
        shadowRootsController.cleanupDisconnectedShadowRoots
      ) {
        // The controller owns a sliced registry cleanup. It is both safer and
        // cheaper than walking every node in a potentially huge removed
        // subtree merely to discover its shadow hosts. The root removal itself
        // remains a complete replay mutation.
        shadowRootsController.cleanupDisconnectedShadowRoots()
        disconnectedShadowRootsCleaned = true
      } else if (!shadowRootsController.cleanupDisconnectedShadowRoots) {
        // Preserve compatibility with lightweight/custom controllers that do
        // not own a registry by falling back to the bounded subtree walk.
        mutation.removedNodes.forEach(function (removedNode) {
          if (
            !removedSubtreeTraversalState.overflowed &&
            !traverseRemovedShadowDom(
              removedNode,
              shadowRootsController.removeShadowRoot,
              removedSubtreeTraversalState
            )
          ) {
            removedSubtreeTraversalState.overflowed = true
          }
        })
        if (removedSubtreeTraversalState.overflowed) {
          if (shadowRootsController.reset) {
            try {
              shadowRootsController.reset()
            } catch (_) {}
          }
          mutationTasksController.handleOverflow({
            reason: 'removed_subtree_watermark',
            mutationNodeCount: removedSubtreeTraversalState.nodeCount
          })
          return
        }
      }
    }

    var target = mutation.target
    var pendingRootTask = mutationTasksController.findPendingRootTask(target)
    if (
      !target.isConnected ||
      (!nodeAndAncestorsHaveSerializedNode(target) && !pendingRootTask) ||
      (isNodeIgnored(target) && !pendingRootTask) ||
      getNodePrivacyLevel(
        target,
        configuration.defaultPrivacyLevel,
        nodePrivacyLevelCache
      ) === NodePrivacyLevel.HIDDEN
    ) {
      continue
    }

    switch (mutation.type) {
      case 'childList':
        childListMutations.push(mutation)
        break
      case 'characterData':
        characterDataMutations.push(mutation)
        break
      case 'attributes':
        attributeMutations.push(mutation)
        break
    }
  }
  if (
    consumeMutationNormalizationBudget(
      normalizationState,
      mutationTasksController,
      true
    )
  ) {
    return
  }

  var supportsMutationGroups = Boolean(
    mutationTasksController.createMutationGroup
  )
  var isPureAddTransaction = Boolean(
    transactionState && transactionState.$rPureAdd
  )
  if (transactionState && transactionState.$rFailed) {
    return false
  }
  var shouldCreateMutationGroup =
    supportsMutationGroups &&
    ((!isPureAddTransaction && Boolean(transactionState)) ||
      shouldUseAtomicMutationGroup(
        childListMutations,
        characterDataMutations,
        attributeMutations
      ))
  var mutationGroup
  if (transactionState && !isPureAddTransaction) {
    if (!transactionState.$rMutationGroup) {
      transactionState.$rMutationGroup =
        mutationTasksController.createMutationGroup(mutationCallback)
      if (transactionState.$rMutationGroup) {
        transactionState.$rMutationGroup.$rTransactionState = transactionState
      }
      transactionState.$rPayload = {
        removes: [],
        texts: [],
        attributes: []
      }
    }
    mutationGroup = transactionState.$rMutationGroup
  } else if (shouldCreateMutationGroup) {
    mutationGroup = mutationTasksController.createMutationGroup(
      mutationCallback
    )
  }
  // Overflow recovery can synchronously reset the controller from inside the
  // callback. An empty result is therefore the durable failure signal; the
  // transient overflow flag is not safe to re-read here.
  if (shouldCreateMutationGroup && !mutationGroup) {
    if (transactionState) {
      transactionState.$rFailed = true
    }
    return false
  }
  var _processChildListMutations = processChildListMutations(
    childListMutations,
    configuration,
    shadowRootsController,
    nodePrivacyLevelCache,
    mutationTasksController,
    pendingRootTasksToRefresh,
    normalizationState,
    isNodePublished,
    mutationGroup,
    mutationBatchContext &&
      mutationBatchContext.$rTextReplacementByRemovedNode
  )
  var removes = _processChildListMutations.removes
  var serializedNodeIds = _processChildListMutations.serializedNodeIds
  if (_processChildListMutations.overflowed) {
    cancelNormalizedMutationGroup(
      mutationTasksController,
      mutationGroup
    )
    return
  }

  function hasBeenSerialized(node) {
    return (
      hasSerializedNode(node) &&
      serializedNodeIds.has(getSerializedNodeId(node))
    )
  }

  var pendingCharacterDataMutations = []
  for (
    var _a = 0, characterDataMutations_1 = characterDataMutations;
    _a < characterDataMutations_1.length;
    _a++
  ) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      cancelNormalizedMutationGroup(
        mutationTasksController,
        mutationGroup
      )
      return
    }
    var characterDataMutation = characterDataMutations_1[_a]
    var pendingCharacterDataRootTask = mutationTasksController.findPendingRootTask(
      characterDataMutation.target
    )
    if (pendingCharacterDataRootTask) {
      pendingRootTasksToRefresh.add(pendingCharacterDataRootTask)
      continue
    }
    if (!hasBeenSerialized(characterDataMutation.target)) {
      pendingCharacterDataMutations.push(characterDataMutation)
    }
  }
  var texts = processCharacterDataMutations(
    pendingCharacterDataMutations,
    configuration,
    nodePrivacyLevelCache,
    mutationTasksController,
    normalizationState,
    currentSourceState,
    transactionState &&
      (transactionState.$rHandledCharacterDataNodes ||
        (transactionState.$rHandledCharacterDataNodes = new Set()))
  )
  consumeMutationNormalizationBudget(
    normalizationState,
    mutationTasksController,
    true
  )
  if (normalizationState.exhausted) {
    cancelNormalizedMutationGroup(
      mutationTasksController,
      mutationGroup
    )
    return
  }
  if (mutationTasksController.isOverflowed()) {
    cancelNormalizedMutationGroup(
      mutationTasksController,
      mutationGroup
    )
    return
  }
  var pendingAttributeMutations = []
  for (
    var _b = 0, attributeMutations_1 = attributeMutations;
    _b < attributeMutations_1.length;
    _b++
  ) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      cancelNormalizedMutationGroup(
        mutationTasksController,
        mutationGroup
      )
      return
    }
    var attributeMutation = attributeMutations_1[_b]
    var pendingAttributeRootTask = mutationTasksController.findPendingRootTask(
      attributeMutation.target
    )
    if (pendingAttributeRootTask) {
      pendingRootTasksToRefresh.add(pendingAttributeRootTask)
      continue
    }
    if (!hasBeenSerialized(attributeMutation.target)) {
      pendingAttributeMutations.push(attributeMutation)
    }
  }
  var attributes = processAttributesMutations(
    pendingAttributeMutations,
    configuration,
    nodePrivacyLevelCache,
    mutationTasksController,
    normalizationState,
    currentSourceState,
    transactionState &&
      (transactionState.$rHandledAttributeMutations ||
        (transactionState.$rHandledAttributeMutations = new Map()))
  )
  consumeMutationNormalizationBudget(
    normalizationState,
    mutationTasksController,
    true
  )
  if (normalizationState.exhausted) {
    cancelNormalizedMutationGroup(
      mutationTasksController,
      mutationGroup
    )
    return
  }
  if (mutationTasksController.isOverflowed()) {
    cancelNormalizedMutationGroup(
      mutationTasksController,
      mutationGroup
    )
    return
  }
  var rootTasksToRefresh = Array.from(pendingRootTasksToRefresh)
  var refreshedRootTasks =
    transactionState && rootTasksToRefresh.length
      ? transactionState.$rRefreshedRootTasks ||
        (transactionState.$rRefreshedRootTasks = new Set())
      : undefined
  for (
    var refreshIndex = 0;
    refreshIndex < rootTasksToRefresh.length;
    refreshIndex += 1
  ) {
    var rootTaskToRefresh = rootTasksToRefresh[refreshIndex]
    if (
      refreshedRootTasks &&
      refreshedRootTasks.has(rootTaskToRefresh)
    ) {
      continue
    }
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      cancelNormalizedMutationGroup(
        mutationTasksController,
        mutationGroup
      )
      return
    }
    if (
      !mutationTasksController.refreshPendingRootTask(
        rootTaskToRefresh
      )
    ) {
      cancelNormalizedMutationGroup(
        mutationTasksController,
        mutationGroup
      )
      return
    }
    if (refreshedRootTasks) {
      refreshedRootTasks.add(rootTaskToRefresh)
    }
  }
  if (
    consumeMutationNormalizationBudget(
      normalizationState,
      mutationTasksController,
      true
    )
  ) {
    cancelNormalizedMutationGroup(
      mutationTasksController,
      mutationGroup
    )
    return
  }
  if (transactionState && !isPureAddTransaction) {
    Array.prototype.push.apply(transactionState.$rPayload.removes, removes)
    Array.prototype.push.apply(transactionState.$rPayload.texts, texts)
    Array.prototype.push.apply(
      transactionState.$rPayload.attributes,
      attributes
    )
    if (mutationBatchContext.isLast) {
      completeNormalizedMutation(
        mutationCallback,
        mutationTasksController,
        mutationGroup,
        transactionState.$rPayload.removes,
        transactionState.$rPayload.texts,
        transactionState.$rPayload.attributes
      )
      transactionState.$rCompleted = true
    }
  } else {
    completeNormalizedMutation(
      mutationCallback,
      mutationTasksController,
      mutationGroup,
      removes,
      texts,
      attributes
    )
  }
  return true
}

function shouldUseAtomicMutationGroup(
  childListMutations,
  characterDataMutations,
  attributeMutations
) {
  if (characterDataMutations.length || attributeMutations.length) {
    return true
  }
  for (
    var mutationIndex = 0;
    mutationIndex < childListMutations.length;
    mutationIndex += 1
  ) {
    var mutation = childListMutations[mutationIndex]
    if (mutation.removedNodes.length) {
      return true
    }
  }
  return false
}

function completeNormalizedMutation(
  mutationCallback,
  mutationTasksController,
  mutationGroup,
  removes,
  texts,
  attributes
) {
  if (
    mutationGroup &&
    mutationTasksController.completeMutationGroup
  ) {
    mutationTasksController.completeMutationGroup(mutationGroup, {
      adds: [],
      removes: removes,
      texts: texts,
      attributes: attributes
    })
    return
  }
  if (!texts.length && !attributes.length && !removes.length) {
    return
  }
  mutationCallback({
    adds: [],
    removes: removes,
    texts: texts,
    attributes: attributes
  })
}

function cancelNormalizedMutationGroup(
  mutationTasksController,
  mutationGroup
) {
  if (
    mutationGroup &&
    mutationTasksController.cancelMutationGroup
  ) {
    if (mutationGroup.$rTransactionState) {
      mutationGroup.$rTransactionState.$rFailed = true
    }
    mutationTasksController.cancelMutationGroup(mutationGroup)
  }
}

function processChildListMutations(
  mutations,
  configuration,
  shadowRootsController,
  nodePrivacyLevelCache,
  mutationTasksController,
  pendingRootTasksToRefresh,
  normalizationState,
  isNodePublished,
  mutationGroup,
  coalescedTextReplacementByRemovedNode
) {
  // First, we iterate over mutations to collect:
  //
  // * nodes that have been added in the document and not removed by a subsequent mutation
  // * nodes that have been removed from the document but were not added in a previous mutation
  //
  // For this second category, we also collect their previous parent (mutation.target) because we'll
  // need it to emit a 'remove' mutation.
  //
  // Those two categories may overlap: if a node moved from a position to another, it is reported as
  // two mutation records, one with a "removedNodes" and the other with "addedNodes". In this case,
  // the node will be in both sets.
  var addedAndMovedNodes = new Set()
  var removedNodes = new Map()
  var replacementNodes = new Set()
  var singleReplacementNodes = new Map()
  for (var _i = 0, mutations_1 = mutations; _i < mutations_1.length; _i++) {
    var mutation = mutations_1[_i]
    var coalescedTextReplacementMarker = undefined
    var expectedTextReplacementSource
    if (coalescedTextReplacementByRemovedNode) {
      for (
        var markerIndex = 0;
        markerIndex < mutation.removedNodes.length;
        markerIndex += 1
      ) {
        var markerSource = mutation.removedNodes[markerIndex]
        var currentMarker =
          coalescedTextReplacementByRemovedNode.get(markerSource)
        if (currentMarker) {
          if (coalescedTextReplacementMarker) {
            mutationTasksController.handleOverflow({
              reason: 'published_move_cancelled'
            })
            return createChildListNormalizationOverflowResult()
          }
          coalescedTextReplacementMarker = currentMarker
          expectedTextReplacementSource = markerSource
        }
      }
    }
    if (coalescedTextReplacementMarker) {
      var markerAddedNode = mutation.addedNodes[0]
      var markerReachedFinal =
        markerAddedNode === coalescedTextReplacementMarker[1]
      if (
        mutation.removedNodes.length !== 1 ||
        mutation.addedNodes.length !== 1 ||
        expectedTextReplacementSource.nodeType !== 3 ||
        !markerAddedNode ||
        markerAddedNode.nodeType !== 3 ||
        mutation.target !== coalescedTextReplacementMarker[0] ||
        expectedTextReplacementSource.isConnected ||
        isNodePublished(expectedTextReplacementSource) ||
        mutationTasksController.findPendingRootTask(
          expectedTextReplacementSource
        ) ||
        (!markerReachedFinal &&
          (markerAddedNode.isConnected ||
            isNodePublished(markerAddedNode) ||
            mutationTasksController.findPendingRootTask(markerAddedNode)))
      ) {
        mutationTasksController.handleOverflow({
          reason: 'published_move_cancelled'
        })
        return createChildListNormalizationOverflowResult()
      }
      coalescedTextReplacementByRemovedNode.delete(
        expectedTextReplacementSource
      )
      if (!markerReachedFinal) {
        coalescedTextReplacementByRemovedNode.set(
          markerAddedNode,
          coalescedTextReplacementMarker
        )
      }
      if (
        consumeMutationNormalizationBudget(
          normalizationState,
          mutationTasksController
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      continue
    }
    if (
      mutation.removedNodes.length === 1 &&
      mutation.addedNodes.length === 1 &&
      mutation.removedNodes[0] !== mutation.addedNodes[0]
    ) {
      singleReplacementNodes.set(
        mutation.removedNodes[0],
        [
          mutation.addedNodes[0],
          mutation.target,
          mutation.previousSibling,
          mutation.nextSibling
        ]
      )
    }
    var hasPublishedRemoval = false
    for (
      var publishedRemovalIndex = 0;
      publishedRemovalIndex < mutation.removedNodes.length;
      publishedRemovalIndex += 1
    ) {
      if (
        consumeMutationNormalizationBudget(
          normalizationState,
          mutationTasksController
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      if (
        isNodePublished(mutation.removedNodes[publishedRemovalIndex]) ||
        replacementNodes.has(mutation.removedNodes[publishedRemovalIndex])
      ) {
        hasPublishedRemoval = true
        break
      }
    }
    for (
      var addedIndex = 0;
      addedIndex < mutation.addedNodes.length;
      addedIndex += 1
    ) {
      if (
        consumeMutationNormalizationBudget(
          normalizationState,
          mutationTasksController
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      var addedNode = mutation.addedNodes[addedIndex]
      addedAndMovedNodes.add(addedNode)
      if (hasPublishedRemoval) {
        replacementNodes.add(addedNode)
      }
    }
    for (
      var removedIndex = 0;
      removedIndex < mutation.removedNodes.length;
      removedIndex += 1
    ) {
      if (
        consumeMutationNormalizationBudget(
          normalizationState,
          mutationTasksController
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      var removedNode = mutation.removedNodes[removedIndex]
      if (!addedAndMovedNodes.has(removedNode)) {
        removedNodes.set(removedNode, mutation.target)
      }
      addedAndMovedNodes.delete(removedNode)
    }
  }

  // A renderer can replace the same text/element again before the previous
  // asynchronous add is emitted. Keep the original published removal and
  // retarget its atomic add to the latest node. Treating the unpublished
  // intermediate node as a cancelled published move would unnecessarily
  // invalidate the whole replay while counters or framework text churn.
  var singleReplacementEntries = Array.from(singleReplacementNodes)
  for (
    var replacementIndex = 0;
    replacementIndex < singleReplacementEntries.length;
    replacementIndex += 1
  ) {
    var replacementEntry = singleReplacementEntries[replacementIndex]
    var replacedNode = replacementEntry[0]
    var replacementNode = replacementEntry[1][0]
    var replacementParent = replacementEntry[1][1]
    var replacementDepth = 0
    while (
      !replacementNode.isConnected &&
      replacementDepth < singleReplacementNodes.size
    ) {
      if (
        consumeMutationNormalizationBudget(
          normalizationState,
          mutationTasksController
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      var intermediateReplacementOwner =
        mutationTasksController.findPendingRootTask(replacementNode)
      if (
        isNodePublished(replacementNode) ||
        (intermediateReplacementOwner &&
          intermediateReplacementOwner.rootNode === replacementNode)
      ) {
        mutationTasksController.handleOverflow({
          reason: 'published_move_cancelled'
        })
        return createChildListNormalizationOverflowResult()
      }
      var nextReplacement = singleReplacementNodes.get(replacementNode)
      if (!nextReplacement || nextReplacement[1] !== replacementParent) {
        break
      }
      replacementNode = nextReplacement[0]
      replacementDepth += 1
    }
    var queuedReplacementSourceNode = replacementNode
    var replacementTask = mutationTasksController.findPendingRootTask(
      replacedNode,
      replacementParent
    )
    var replacementOwner = mutationTasksController.findPendingRootTask(
      replacementNode
    )
    var coalescedDetachedTextReplacement = false
    // A hot textContent loop can detach the text node stored by an older
    // normalization chunk before that chunk runs. Resolve only the exact live
    // node occupying the MutationRecord's sibling slot. This is O(1), and all
    // element moves, cross-parent moves, published intermediates, ambiguous
    // slots and task-owner conflicts keep the existing fail-closed path.
    if (
      !replacementNode.isConnected &&
      replacedNode.nodeType === 3 &&
      replacementNode.nodeType === 3 &&
      !isNodePublished(replacementNode) &&
      !replacementOwner &&
      isNodePublished(replacementParent) &&
      (isNodePublished(replacedNode) ||
        (replacementTask &&
          replacementTask.rootNode === replacedNode &&
          replacementTask.requiresBaselineOnDrop))
    ) {
      var currentSlotNode = findCurrentTextNodeAtReplacementSlot(
        replacementParent,
        replacementEntry[1][2],
        replacementEntry[1][3]
      )
      var currentSlotOwner = currentSlotNode
        ? mutationTasksController.findPendingRootTask(currentSlotNode)
        : undefined
      if (
        currentSlotNode &&
        !isNodePublished(currentSlotNode) &&
        !currentSlotOwner
      ) {
        replacementNode = currentSlotNode
        coalescedDetachedTextReplacement = true
      }
    }
    if (coalescedDetachedTextReplacement) {
      if (addedAndMovedNodes.delete(queuedReplacementSourceNode)) {
        addedAndMovedNodes.add(replacementNode)
      }
      if (replacementNodes.delete(queuedReplacementSourceNode)) {
        replacementNodes.add(replacementNode)
      }
      if (coalescedTextReplacementByRemovedNode) {
        coalescedTextReplacementByRemovedNode.set(
          queuedReplacementSourceNode,
          [replacementParent, replacementNode]
        )
      }
    }
    if (
      replacementTask &&
      replacementTask.rootNode === replacedNode &&
      !replacementOwner &&
      !isNodePublished(replacementNode) &&
      !replacedNode.isConnected &&
      replacementNode.isConnected &&
      getParentNode(replacementNode) === replacementParent
    ) {
      if (
        !mutationTasksController.$rRetargetPendingRootTask(
          replacementTask,
          replacementNode
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      removedNodes.delete(replacedNode)
      addedAndMovedNodes.delete(replacementNode)
    }
  }

  var publishedMoveDependencyRoots = new Set()
  var sharedDependencyState = getMutationDependencyState(
    shadowRootsController
  )
  var removedNodesForDependency = Array.from(removedNodes.keys())
  for (
    var dependencyIndex = 0;
    dependencyIndex < removedNodesForDependency.length;
    dependencyIndex += 1
  ) {
    var publishedRemovedNode = removedNodesForDependency[dependencyIndex]
    if (!isNodePublished(publishedRemovedNode)) {
      continue
    }
    var currentDependencyNode = publishedRemovedNode
    var dependencyDepth = 0
    while (
      currentDependencyNode &&
      dependencyDepth < MAX_SERIALIZED_NODE_ANCESTOR_DEPTH
    ) {
      if (
        consumeMutationNormalizationBudget(
          normalizationState,
          mutationTasksController
        )
      ) {
        return createChildListNormalizationOverflowResult()
      }
      if (sharedDependencyState) {
        sharedDependencyState.$rPublishedRoots.add(
          currentDependencyNode
        )
        if (
          sharedDependencyState.$rLocallyDroppedRoots.has(
            currentDependencyNode
          )
        ) {
          mutationTasksController.handleOverflow({
            reason: 'published_move_serialization_watermark'
          })
          return createChildListNormalizationOverflowResult()
        }
      }
      if (addedAndMovedNodes.has(currentDependencyNode)) {
        publishedMoveDependencyRoots.add(currentDependencyNode)
        break
      }
      currentDependencyNode = getParentNode(currentDependencyNode)
      dependencyDepth += 1
    }
  }

  // Then, we sort nodes that are still in the document by topological order, for two reasons:
  //
  // * We will serialize each added nodes with their descendants. We don't want to serialize a node
  // twice, so we need to iterate over the parent nodes first and skip any node that is contained in
  // a precedent node.
  //
  // * To emit "add" mutations, we need references to the parent and potential next sibling of each
  // added node. So we need to iterate over the parent nodes first, and when multiple nodes are
  // siblings, we want to iterate from last to first. This will ensure that any "next" node is
  // already serialized and have an id.
  var sortedAddedAndMovedNodes = Array.from(addedAndMovedNodes)
  if (!sortAddedAndMovedNodes(sortedAddedAndMovedNodes, normalizationState)) {
    // Sorting can dominate the observer callback for a wide mutation batch.
    // The batch is still unpublished here. Retire its complete serializer
    // generation and require a replacement baseline rather than publishing a
    // partially ordered prefix.
    abortMutationNormalization(normalizationState, mutationTasksController)
    return createChildListNormalizationOverflowResult()
  }

  // Then, we iterate over our sorted node sets to emit mutations. We collect the newly serialized
  // node ids in a set to be able to skip subsequent related mutations.
  var serializedNodeIds = new Set()

  for (
    var _a = 0, sortedAddedAndMovedNodes_1 = sortedAddedAndMovedNodes;
    _a < sortedAddedAndMovedNodes_1.length;
    _a++
  ) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      return createChildListNormalizationOverflowResult()
    }
    var node = sortedAddedAndMovedNodes_1[_a]
    var pendingRootTask = mutationTasksController.findPendingRootTask(node)
    if (pendingRootTask) {
      if (isNodePublished(node)) {
        mutationTasksController.markPendingRootTaskPublishedDependency(
          pendingRootTask
        )
      }
      pendingRootTasksToRefresh.add(pendingRootTask)
      continue
    }

    if (hasBeenSerialized(node)) {
      continue
    }

    var parentNodePrivacyLevel = getNodePrivacyLevel(
      node.parentNode,
      configuration.defaultPrivacyLevel,
      nodePrivacyLevelCache
    )
    if (
      parentNodePrivacyLevel === NodePrivacyLevel.HIDDEN ||
      parentNodePrivacyLevel === NodePrivacyLevel.IGNORE
    ) {
      continue
    }

    if (
      !mutationTasksController.addPendingRootTask(node, {
        serializedNodeIds: serializedNodeIds,
        parentNodePrivacyLevel: parentNodePrivacyLevel,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController: shadowRootsController
        },
        configuration,
        normalizationState: normalizationState,
        // A task paired with a published removal is part of one atomic
        // replacement. If its add cannot be serialized, emitting only the
        // removal would leave a permanent hole in the replay tree.
        requiresBaselineOnDrop:
          isNodePublished(node) ||
          replacementNodes.has(node) ||
          publishedMoveDependencyRoots.has(node) ||
          (sharedDependencyState &&
            sharedDependencyState.$rPublishedRoots.has(node)),
        mutationGroup: mutationGroup
      })
    ) {
      return {
        removes: [],
        serializedNodeIds: serializedNodeIds,
        overflowed: true
      }
    }
  }
  // Finally, we emit remove mutations.
  var removedNodeMutations = []
  var pendingRootRemovalOverflowed = false
  var removedNodeEntries = Array.from(removedNodes)
  for (
    var removedEntryIndex = 0;
    removedEntryIndex < removedNodeEntries.length;
    removedEntryIndex += 1
  ) {
    if (pendingRootRemovalOverflowed) {
      break
    }
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      return createChildListNormalizationOverflowResult()
    }
    var removedNodeEntry = removedNodeEntries[removedEntryIndex]
    var node = removedNodeEntry[0]
    var parent = removedNodeEntry[1]
    // A removed descendant is already detached when the MutationRecord is
    // processed, so walking from it can no longer reach an unpublished
    // pending root. The mutation target is its former parent and still gives
    // us the path needed to refresh that root instead of publishing a stale
    // subtree followed by an ineffective remove.
    var pendingRootTask = mutationTasksController.findPendingRootTask(
      node,
      parent
    )
    if (pendingRootTask) {
      if (isNodePublished(node)) {
        mutationTasksController.markPendingRootTaskPublishedDependency(
          pendingRootTask
        )
      }
      if (
        node !== pendingRootTask.rootNode &&
        pendingRootTask.rootNode.isConnected
      ) {
        // Several descendants can be removed in one batch. Rebuild the
        // unpublished root once after normalization instead of once per node.
        pendingRootTasksToRefresh.add(pendingRootTask)
        continue
      }
      pendingRootTasksToRefresh.delete(pendingRootTask)
      if (
        !mutationTasksController.handlePendingRootRemoval(
          pendingRootTask,
          node
        )
      ) {
        pendingRootRemovalOverflowed = true
      }
      continue
    }
    if (hasSerializedNode(node) && isNodePublished(node)) {
      var removeMutation = {
        parentId: getSerializedNodeId(parent),
        id: getSerializedNodeId(node)
      }
      sourceNodeByMutationRemove.set(removeMutation, node)
      removedNodeMutations.push(removeMutation)
    }
  }
  if (pendingRootRemovalOverflowed) {
    return {
      removes: [],
      serializedNodeIds: serializedNodeIds,
      overflowed: true
    }
  }

  return {
    removes: removedNodeMutations,
    serializedNodeIds: serializedNodeIds,
    hasBeenSerialized: hasBeenSerialized
  }

  function hasBeenSerialized(node) {
    return (
      hasSerializedNode(node) &&
      serializedNodeIds.has(getSerializedNodeId(node))
    )
  }
}

function findCurrentTextNodeAtReplacementSlot(
  parent,
  previousSibling,
  nextSibling
) {
  // `undefined` means the synthetic record did not preserve native slot
  // evidence. Never infer a replacement from the current DOM in that case.
  if (previousSibling === undefined || nextSibling === undefined) {
    return
  }
  if (
    (previousSibling &&
      getParentNode(previousSibling) !== parent) ||
    (nextSibling &&
      getParentNode(nextSibling) !== parent)
  ) {
    return
  }
  var candidate = previousSibling
    ? previousSibling.nextSibling
    : parent.firstChild
  if (
    !candidate ||
    candidate === nextSibling ||
    candidate.nextSibling !== nextSibling ||
    !candidate.isConnected ||
    candidate.nodeType !== 3
  ) {
    return
  }
  return candidate
}

function createChildListNormalizationOverflowResult() {
  return {
    removes: [],
    serializedNodeIds: new Set(),
    overflowed: true
  }
}

function processCharacterDataMutations(
  mutations,
  configuration,
  nodePrivacyLevelCache,
  mutationTasksController,
  normalizationState,
  currentSourceState,
  handledNodes
) {
  var textMutations = []

  // Deduplicate mutations based on their target node
  handledNodes = handledNodes || new Set()
  var filteredMutations = mutations.filter(function (mutation) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      return false
    }
    if (handledNodes.has(mutation.target)) {
      return false
    }
    handledNodes.add(mutation.target)
    return true
  })

  // Emit mutations
  for (
    var _i = 0, filteredMutations_1 = filteredMutations;
    _i < filteredMutations_1.length;
    _i++
  ) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      return textMutations
    }
    var mutation = filteredMutations_1[_i]
    var value = mutation.target.textContent
    if (value === mutation.oldValue) {
      continue
    }

    var parentNodePrivacyLevel = getNodePrivacyLevel(
      getParentNode(mutation.target),
      configuration.defaultPrivacyLevel,
      nodePrivacyLevelCache
    )
    if (
      parentNodePrivacyLevel === NodePrivacyLevel.HIDDEN ||
      parentNodePrivacyLevel === NodePrivacyLevel.IGNORE
    ) {
      continue
    }

    var serializedTextValue = truncateSerializedValue(
      isNullUndefinedDefaultValue(
        getTextContent(
          configuration,
          mutation.target,
          false,
          parentNodePrivacyLevel,
          null
        )
      ),
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    if (
      !reserveCurrentMutationSource(
        serializedTextValue,
        currentSourceState
      )
    ) {
      mutationTasksController.handleOverflow({
        reason: 'mutation_current_source_watermark',
        mutationApproxBytes: currentSourceState.characters * 2
      })
      return []
    }
    textMutations.push({
      id: getSerializedNodeId(mutation.target),
      value: serializedTextValue
    })
  }

  return textMutations
}

function processAttributesMutations(
  mutations,
  configuration,
  nodePrivacyLevelCache,
  mutationTasksController,
  normalizationState,
  currentSourceState,
  handledElements
) {
  var attributeMutations = []

  // Deduplicate mutations based on their target node and changed attribute
  handledElements = handledElements || new Map()
  var filteredMutations = mutations.filter(function (mutation) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      return false
    }
    var handledAttributes = handledElements.get(mutation.target)
    if (handledAttributes && handledAttributes.has(mutation.attributeName)) {
      return false
    }
    if (!handledAttributes) {
      handledElements.set(mutation.target, new Set([mutation.attributeName]))
    } else {
      handledAttributes.add(mutation.attributeName)
    }
    return true
  })

  // Emit mutations
  var emittedMutations = new Map()
  for (
    var _i = 0, filteredMutations_2 = filteredMutations;
    _i < filteredMutations_2.length;
    _i++
  ) {
    if (
      consumeMutationNormalizationBudget(
        normalizationState,
        mutationTasksController
      )
    ) {
      return attributeMutations
    }
    var mutation = filteredMutations_2[_i]
    var uncensoredValue = mutation.target.getAttribute(mutation.attributeName)
    if (uncensoredValue === mutation.oldValue) {
      continue
    }
    var privacyLevel = getNodePrivacyLevel(
      mutation.target,
      configuration.defaultPrivacyLevel,
      nodePrivacyLevelCache
    )
    var attributeValue = serializeAttribute(
      mutation.target,
      privacyLevel,
      mutation.attributeName,
      configuration
    )

    var transformedValue
    if (mutation.attributeName === 'value') {
      var inputValue = getElementInputValue(
        configuration,
        mutation.target,
        privacyLevel
      )
      if (inputValue === undefined) {
        continue
      }
      transformedValue = inputValue
    } else if (typeof attributeValue === 'string') {
      transformedValue = attributeValue
    } else {
      transformedValue = null
    }
    transformedValue = truncateSerializedValue(
      transformedValue,
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    if (
      !reserveCurrentMutationSource(
        transformedValue,
        currentSourceState
      )
    ) {
      mutationTasksController.handleOverflow({
        reason: 'mutation_current_source_watermark',
        mutationApproxBytes: currentSourceState.characters * 2
      })
      return []
    }

    var emittedMutation = emittedMutations.get(mutation.target)
    if (!emittedMutation) {
      emittedMutation = {
        id: getSerializedNodeId(mutation.target),
        attributes: {}
      }
      attributeMutations.push(emittedMutation)
      emittedMutations.set(mutation.target, emittedMutation)
    }

    emittedMutation.attributes[mutation.attributeName] = transformedValue
  }

  return attributeMutations
}

function reserveCurrentMutationSource(
  value,
  currentSourceState
) {
  if (typeof value !== 'string') {
    return true
  }
  currentSourceState.characters += value.length
  return (
    currentSourceState.characters <=
    MAX_MUTATION_CURRENT_SOURCE_CHARACTERS
  )
}

export function sortAddedAndMovedNodes(nodes, normalizationState) {
  try {
    nodes.sort(function (a, b) {
      if (
        normalizationState &&
        consumeMutationNormalizationBudget(
          normalizationState,
          normalizationState.mutationTasksController
        )
      ) {
        throw MUTATION_NORMALIZATION_ABORT
      }
      var position = a.compareDocumentPosition(b)
      /* eslint-disable no-bitwise */
      if (position & Node.DOCUMENT_POSITION_CONTAINED_BY) {
        return -1
      } else if (position & Node.DOCUMENT_POSITION_CONTAINS) {
        return 1
      } else if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
        return 1
      } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
        return -1
      }
      /* eslint-enable no-bitwise */
      return 0
    })
  } catch (error) {
    if (error === MUTATION_NORMALIZATION_ABORT) {
      return false
    }
    throw error
  }
  return !(
    normalizationState &&
    consumeMutationNormalizationBudget(
      normalizationState,
      normalizationState.mutationTasksController,
      true
    )
  )
}

function consumeMutationNormalizationBudget(
  normalizationState,
  mutationTasksController,
  forceTimeCheck
) {
  if (normalizationState.exhausted) {
    return true
  }
  normalizationState.timeCheckCount += 1
  if (
    !forceTimeCheck &&
    normalizationState.timeCheckCount %
      MUTATION_NORMALIZATION_TIME_CHECK_INTERVAL !==
      0
  ) {
    return false
  }
  if (
    normalizationState.mutationRecordCount <=
      MUTATION_NORMALIZATION_SMALL_BATCH_MAX_RECORDS &&
    normalizationState.timeCheckCount <
      MUTATION_NORMALIZATION_MIN_OPERATIONS_BEFORE_TIMEOUT
  ) {
    return false
  }
  if (getCurrentTime() < normalizationState.deadline) {
    return false
  }
  abortMutationNormalization(
    normalizationState,
    mutationTasksController
  )
  return true
}

function abortMutationNormalization(
  normalizationState,
  mutationTasksController
) {
  if (normalizationState.exhausted) {
    return
  }
  normalizationState.exhausted = true
  mutationTasksController.handleOverflow({
    reason: 'mutation_normalization_budget',
    mutationRecordCount: normalizationState.mutationRecordCount
  })
}

export function createMutationTasksController(
  mutationCallback,
  configuration,
  shadowRootsController,
  mutationPerfCb,
  mutationOverflowCb,
  mutationNodeSerializationCb,
  isNodeIgnored,
  mutationResourceBudget
) {
  isNodeIgnored = isNodeIgnored || function () {
    return false
  }
  var generation = 0
  var nextTaskSequence = 0
  var nextEmitSequence = 0
  var pendingMutationGroups = []
  var pendingMutationGroupHead = 0
  var pendingRootTasks = []
  var pendingRootTaskHead = 0
  var pendingRootTaskContinuation
  var pendingRootTaskCount = 0
  var activeRootTaskCount = 0
  var deferredRootTaskCount = 0
  var deferredRootTaskOutstandingCount = 0
  var pendingRootTaskByRootNode = new WeakMap()
  var pendingRootTaskBySequence = new Map()
  var scheduledFlush = undefined
  var stopped = false
  var overflowed = false
  var overflowCount = 0
  var retainedRootTaskApproxBytes = 0
  var retainedMutationGroupApproxBytes = 0
  var retainedMutationBudgetReservation
  var completedRootTasksBySequence = new Map()
  var locallyDroppedRootNodes = new WeakSet()

  return {
    createMutationGroup: createMutationGroup,
    completeMutationGroup: completeMutationGroup,
    cancelMutationGroup: cancelMutationGroup,
    addPendingRootTask: addPendingRootTask,
    findPendingRootTask: findPendingRootTask,
    markPendingRootTaskPublishedDependency:
      markPendingRootTaskPublishedDependency,
    refreshAndFlushPendingRootForNode:
      refreshAndFlushPendingRootForNode,
    refreshPendingRootTask: refreshPendingRootTask,
    $rRetargetPendingRootTask: retargetPendingRootTask,
    handlePendingRootRemoval: handlePendingRootRemoval,
    dropMutationGroupTasks: dropMutationGroupTasks,
    handleOverflow: handleOverflow,
    getOverflowCount: function () {
      return overflowCount
    },
    isOverflowed: function () {
      return overflowed
    },
    flush: function () {
      if (overflowed) {
        return false
      }
      var flushResult = processPendingRootTasks(
        getCurrentTime() + MUTATION_SERIALIZATION_FLUSH_BUDGET_MS,
        true
      )
      if (flushResult === false && deferredRootTaskOutstandingCount) {
        return 'pending'
      }
      return flushResult
    },
    reset: reset,
    stop: function () {
      stopped = true
      overflowed = false
      clearMutationTaskState()
    }
  }

  function clearMutationTaskState() {
    pendingRootTaskBySequence.forEach(function (task) {
      cancelPublicationToken(task.publicationToken)
    })
    for (
      var groupIndex = pendingMutationGroupHead;
      groupIndex < pendingMutationGroups.length;
      groupIndex += 1
    ) {
      cancelMutationGroupPublicationTokens(
        pendingMutationGroups[groupIndex]
      )
    }
    generation += 1
    nextTaskSequence = 0
    nextEmitSequence = 0
    pendingMutationGroups = []
    pendingMutationGroupHead = 0
    clearScheduledFlush()
    pendingRootTasks = []
    pendingRootTaskHead = 0
    pendingRootTaskContinuation = undefined
    pendingRootTaskCount = 0
    activeRootTaskCount = 0
    deferredRootTaskCount = 0
    deferredRootTaskOutstandingCount = 0
    retainedRootTaskApproxBytes = 0
    retainedMutationGroupApproxBytes = 0
    updateRetainedMutationResourceBudget()
    completedRootTasksBySequence = new Map()
    locallyDroppedRootNodes = new WeakSet()
    pendingRootTaskByRootNode = new WeakMap()
    pendingRootTaskBySequence = new Map()
  }

  function reset() {
    overflowed = false
    clearMutationTaskState()
  }

  function createMutationGroup(callback) {
    if (stopped || overflowed) {
      return
    }
    if (
      pendingMutationGroups.length - pendingMutationGroupHead >=
        MAX_PENDING_MUTATION_GROUPS ||
      getRetainedMutationApproxBytes() + 64 >
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
    ) {
      handleOverflow({
        reason: 'mutation_group_watermark',
        mutationRecordCount:
          pendingMutationGroups.length -
          pendingMutationGroupHead +
          1,
        mutationApproxBytes: getRetainedMutationApproxBytes() + 64
      })
      return
    }
    var mutationGroup = {
      active: true,
      generation: generation,
      sequence: nextTaskSequence,
      callback: callback || mutationCallback,
      payload: {
        adds: [],
        removes: [],
        texts: [],
        attributes: []
      },
      approxBytes: 64,
      approxBytesReleased: false,
      pendingTaskCount: 0,
      closed: false,
      canceled: false
    }
    pendingMutationGroups.push(mutationGroup)
    retainedMutationGroupApproxBytes += mutationGroup.approxBytes
    if (!updateRetainedMutationResourceBudget()) {
      handleOverflow({
        reason: AGGREGATE_RETAINED_MUTATION_WATERMARK,
        mutationApproxBytes: getRetainedMutationApproxBytes()
      })
      return
    }
    return mutationGroup
  }

  function completeMutationGroup(mutationGroup, payload) {
    if (
      !isActiveMutationGroup(mutationGroup) ||
      mutationGroup.canceled ||
      mutationGroup.closed
    ) {
      return
    }
    var payloadApproxBytes =
      estimateMutationGroupPayloadApproxBytes(payload)
    if (
      getRetainedMutationApproxBytes() + payloadApproxBytes >
      MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
    ) {
      handleOverflow({
        reason: 'mutation_group_byte_watermark',
        mutationApproxBytes:
          getRetainedMutationApproxBytes() + payloadApproxBytes
      })
      return false
    }
    mutationGroup.approxBytes += payloadApproxBytes
    retainedMutationGroupApproxBytes += payloadApproxBytes
    if (!updateRetainedMutationResourceBudget()) {
      return handleOverflow({
        reason: AGGREGATE_RETAINED_MUTATION_WATERMARK,
        mutationApproxBytes: getRetainedMutationApproxBytes()
      })
    }
    Array.prototype.push.apply(
      mutationGroup.payload.removes,
      payload.removes
    )
    Array.prototype.push.apply(
      mutationGroup.payload.texts,
      payload.texts
    )
    Array.prototype.push.apply(
      mutationGroup.payload.attributes,
      payload.attributes
    )
    mutationGroup.closed = true
    emitReadyMutationGroups()
  }

  function cancelMutationGroup(mutationGroup) {
    if (!isActiveMutationGroup(mutationGroup)) {
      return
    }
    mutationGroup.canceled = true
    mutationGroup.closed = true
    cancelMutationGroupPublicationTokens(mutationGroup)
    releaseMutationGroupApproxBytes(mutationGroup)
    Array.from(pendingRootTaskBySequence.values()).forEach(function (task) {
      if (task.mutationGroup === mutationGroup) {
        cancelPendingRootTask(task)
      }
    })
    emitReadyMutationGroups()
  }

  function cancelMutationGroupPublicationTokens(mutationGroup) {
    mutationGroup.payload.adds.forEach(function (add) {
      cancelPublicationToken(consumeMutationAddPublicationToken(add))
    })
    mutationGroup.payload.adds = []
  }

  function isActiveMutationGroup(mutationGroup) {
    return Boolean(
      mutationGroup &&
        mutationGroup.active &&
        mutationGroup.generation === generation &&
        !stopped
    )
  }

  function emitReadyMutationGroups() {
    while (pendingMutationGroupHead < pendingMutationGroups.length) {
      var mutationGroup =
        pendingMutationGroups[pendingMutationGroupHead]
      if (
        !mutationGroup ||
        !mutationGroup.closed ||
        mutationGroup.pendingTaskCount ||
        nextEmitSequence < mutationGroup.sequence
      ) {
        return
      }
      mutationGroup.active = false
      pendingMutationGroups[pendingMutationGroupHead] = undefined
      pendingMutationGroupHead += 1
      var mutationGroupApproxBytes = mutationGroup.approxBytes
      releaseMutationGroupApproxBytes(mutationGroup)
      if (
        !mutationGroup.canceled &&
        hasMutationGroupEntries(mutationGroup.payload)
      ) {
        approxBytesByMutationPayload.set(
          mutationGroup.payload,
          mutationGroupApproxBytes
        )
        mutationGroup.callback(mutationGroup.payload)
      }
    }
    pendingMutationGroups = []
    pendingMutationGroupHead = 0
  }

  function hasMutationGroupEntries(payload) {
    return Boolean(
      payload.adds.length ||
        payload.removes.length ||
        payload.texts.length ||
        payload.attributes.length
    )
  }

  function estimateMutationGroupPayloadApproxBytes(payload) {
    return estimateMutationPayloadEntriesApproxBytes(payload)
  }

  function getRetainedMutationApproxBytes() {
    return (
      retainedRootTaskApproxBytes +
      retainedMutationGroupApproxBytes
    )
  }

  function releaseMutationGroupApproxBytes(mutationGroup) {
    if (mutationGroup.approxBytesReleased) {
      return
    }
    mutationGroup.approxBytesReleased = true
    retainedMutationGroupApproxBytes = Math.max(
      retainedMutationGroupApproxBytes - mutationGroup.approxBytes,
      0
    )
    updateRetainedMutationResourceBudget()
  }

  function transferRetainedRootTaskToMutationGroup(
    task,
    mutationGroup
  ) {
    var taskApproxBytes = task.accountedApproxBytes
    task.isRetained = false
    retainedRootTaskApproxBytes = Math.max(
      retainedRootTaskApproxBytes - taskApproxBytes,
      0
    )
    task.accountedApproxBytes = 0
    mutationGroup.approxBytes += taskApproxBytes
    retainedMutationGroupApproxBytes += taskApproxBytes
    releaseActiveRootTask(task)
    releaseDeferredRootTaskOutstanding(task)
  }

  function releaseMutationGroupDependency(task) {
    if (
      task.mutationGroupDependencyReleased ||
      !task.mutationGroup
    ) {
      return
    }
    task.mutationGroupDependencyReleased = true
    if (isActiveMutationGroup(task.mutationGroup)) {
      task.mutationGroup.pendingTaskCount = Math.max(
        task.mutationGroup.pendingTaskCount - 1,
        0
      )
    }
  }

  function handleOverflow(overflow) {
    if (stopped || overflowed) {
      return false
    }
    overflowed = true
    overflowCount += 1
    var shouldReportOverflow =
      !mutationResourceBudget || mutationResourceBudget.failOnce()
    clearMutationTaskState()
    if (shouldReportOverflow && mutationOverflowCb) {
      mutationOverflowCb(overflow)
    }
    return false
  }

  function addPendingRootTask(node, serializationOptions) {
    if (stopped || overflowed) {
      return false
    }
    var isNormalizationTransaction = Boolean(
      serializationOptions.normalizationState &&
        !serializationOptions.normalizationState.exhausted
    )
    var mustDeferNormalizationEmission = Boolean(
      isNormalizationTransaction && !serializationOptions.mutationGroup
    )
    var parentPendingRootTask = findPendingRootTask(getParentNode(node))
    if (parentPendingRootTask) {
      if (serializationOptions.requiresBaselineOnDrop) {
        markPendingRootTaskPublishedDependency(parentPendingRootTask)
      }
      return true
    }
    var canDefer = canDeferPendingRootTask(serializationOptions)
    if (
      deferredRootTaskCount &&
      canDefer
    ) {
      return deferPendingRootTask(node, serializationOptions)
    }
    if (deferredRootTaskCount) {
      // A non-deferred task cannot overtake an older deferred sequence: once
      // later active tasks fill the cap, neither side can publish. Drain the
      // older work within the normal slice before admitting the dependency.
      if (!drainPendingRootTasksForAdmission()) {
        return false
      }
      if (deferredRootTaskCount) {
        return handleOverflow({ reason: MUTATION_ROOT_ADMISSION_WATERMARK })
      }
    }
    if (
      activeRootTaskCount >=
      MAX_PENDING_MUTATION_ROOT_TASKS
    ) {
      if (
        !mustDeferNormalizationEmission &&
        !drainPendingRootTasksForAdmission()
      ) {
        return false
      }
      if (
        activeRootTaskCount >=
        MAX_PENDING_MUTATION_ROOT_TASKS
      ) {
        if (canDefer) {
          return deferPendingRootTask(node, serializationOptions)
        }
        return handleOverflow({
          reason: MUTATION_ROOT_ADMISSION_WATERMARK
        })
      }
    }
    var trackedSerializerTask = createTrackedMutationSerializerTask(
      node,
      serializationOptions
    )
    var serializerTask = trackedSerializerTask.serializerTask
    if (!serializerTask) {
      return dropUnadmittedRootNode(
        node,
        trackedSerializerTask.publicationToken,
        serializationOptions.requiresBaselineOnDrop,
        'published_move_serialization_failed'
      )
    }
    if (serializerTask.isMaxNodeComplexityReached) {
      return dropUnadmittedRootNode(
        node,
        trackedSerializerTask.publicationToken,
        serializationOptions.requiresBaselineOnDrop,
        'published_move_serialization_watermark'
      )
    }
    if (
      serializerTask.approxBytes >
      MUTATION_SERIALIZATION_MAX_APPROX_BYTES
    ) {
      return dropUnadmittedRootNode(
        node,
        trackedSerializerTask.publicationToken,
        serializationOptions.requiresBaselineOnDrop,
        serializationOptions.requiresBaselineOnDrop
          ? 'published_move_serialization_watermark'
          : 'unpublished_add_serialization_watermark',
        true
      )
    }
    if (
      getRetainedMutationApproxBytes() + serializerTask.approxBytes >
      MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
    ) {
      if (mustDeferNormalizationEmission) {
        cancelPublicationToken(trackedSerializerTask.publicationToken)
        if (canDeferPendingRootTask(serializationOptions)) {
          return deferPendingRootTask(node, serializationOptions)
        }
        return handleOverflow({
          reason: MUTATION_ROOT_RETAINED_BYTES_WATERMARK
        })
      }
      if (!drainPendingRootTasksForAdmission()) {
        cancelPublicationToken(trackedSerializerTask.publicationToken)
        return false
      }
      if (
        getRetainedMutationApproxBytes() + serializerTask.approxBytes >
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
      ) {
        cancelPublicationToken(trackedSerializerTask.publicationToken)
        if (canDeferPendingRootTask(serializationOptions)) {
          return deferPendingRootTask(node, serializationOptions)
        }
        return handleOverflow({
          reason: MUTATION_ROOT_RETAINED_BYTES_WATERMARK
        })
      }
    }
    var task = {
      generation: generation,
      sequence: nextTaskSequence++,
      rootNode: node,
      parentId: getSerializedNodeId(getParentNode(node)),
      nextId: null,
      serializerTask: serializerTask,
      publicationToken: trackedSerializerTask.publicationToken,
      serializedNodeIds: serializationOptions.serializedNodeIds,
      refreshCount: 0,
      accountedApproxBytes: serializerTask.approxBytes,
      isRetained: true,
      mutationGroup: isActiveMutationGroup(
        serializationOptions.mutationGroup
      )
        ? serializationOptions.mutationGroup
        : undefined,
      requiresBaselineOnDrop: Boolean(
        serializationOptions.requiresBaselineOnDrop
      ),
      isActiveSerializerTask: true
    }
    if (task.mutationGroup) {
      task.mutationGroup.pendingTaskCount += 1
    }
    retainedRootTaskApproxBytes += task.accountedApproxBytes
    activeRootTaskCount += 1
    if (!updateRetainedMutationResourceBudget()) {
      cancelPublicationToken(task.publicationToken)
      return handleOverflow({
        reason: AGGREGATE_RETAINED_MUTATION_WATERMARK,
        mutationApproxBytes: getRetainedMutationApproxBytes()
      })
    }
    clearLocallyDroppedRootNode(node)
    enqueuePendingRootTask(task)
    pendingRootTaskByRootNode.set(node, task)
    pendingRootTaskBySequence.set(task.sequence, task)
    schedulePendingRootTasks()
    return true
  }

  function drainPendingRootTasksForAdmission() {
    var drainGeneration = generation
    var overflowCountBeforeDrain = overflowCount
    processPendingRootTasks(
      getCurrentTime() + MUTATION_SERIALIZATION_FLUSH_BUDGET_MS,
      true
    )
    return (
      !stopped &&
      generation === drainGeneration &&
      overflowCount === overflowCountBeforeDrain
    )
  }

  function canDeferPendingRootTask(serializationOptions) {
    return Boolean(
      !serializationOptions.requiresBaselineOnDrop &&
        !isActiveMutationGroup(serializationOptions.mutationGroup)
    )
  }

  function deferPendingRootTask(node, serializationOptions) {
    // A dropped unpublished add has no replay-tree dependency yet.  If the
    // lightweight queue itself reaches its hard bound, degrading only that
    // root is safer than replacing (and synchronously serializing) the whole
    // document under the same load spike.
    if (
      deferredRootTaskCount >= MAX_DEFERRED_MUTATION_ROOT_TASKS ||
      getRetainedMutationApproxBytes() +
        DEFERRED_MUTATION_ROOT_TASK_APPROX_BYTES >
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
    ) {
      reportLocalRootDrop(
        deferredRootTaskCount >= MAX_DEFERRED_MUTATION_ROOT_TASKS
          ? MUTATION_ROOT_ADMISSION_WATERMARK
          : MUTATION_ROOT_RETAINED_BYTES_WATERMARK
      )
      markLocallyDroppedRootNode(node)
      return true
    }
    var task = {
      generation: generation,
      sequence: nextTaskSequence++,
      rootNode: node,
      serializedNodeIds: serializationOptions.serializedNodeIds,
      refreshCount: 0,
      accountedApproxBytes: DEFERRED_MUTATION_ROOT_TASK_APPROX_BYTES,
      isRetained: true,
      isDeferred: true,
      wasDeferred: true,
      requiresBaselineOnDrop: false
    }
    retainedRootTaskApproxBytes += task.accountedApproxBytes
    if (!updateRetainedMutationResourceBudget()) {
      retainedRootTaskApproxBytes = Math.max(
        retainedRootTaskApproxBytes - task.accountedApproxBytes,
        0
      )
      task.isRetained = false
      task.accountedApproxBytes = 0
      reportLocalRootDrop(AGGREGATE_RETAINED_MUTATION_WATERMARK)
      markLocallyDroppedRootNode(node)
      return true
    }
    clearLocallyDroppedRootNode(node)
    deferredRootTaskCount += 1
    deferredRootTaskOutstandingCount += 1
    pendingRootTaskByRootNode.set(node, task)
    pendingRootTaskBySequence.set(task.sequence, task)
    enqueuePendingRootTask(task)
    schedulePendingRootTasks()
    return true
  }

  function reportLocalRootDrop(reason) {
    if (mutationPerfCb) {
      mutationPerfCb(
        __BUILD_ENV__REPLAY_DEBUG_ENABLED__
          ? {
              mutationLocalDropCount: 1,
              mutationLocalDropReason: reason
            }
          : reason
      )
    }
  }

  function findPendingRootTask(node, fallbackAncestor) {
    if (overflowed) {
      return
    }
    var current = node
    var depth = 0
    while (current) {
      if (depth >= MAX_SERIALIZED_NODE_ANCESTOR_DEPTH) {
        return
      }
      var task = pendingRootTaskByRootNode.get(current)
      if (task && task.generation === generation) {
        return task
      }
      depth += 1
      current = getParentNode(current)
    }
    if (fallbackAncestor && fallbackAncestor !== node) {
      return findPendingRootTask(fallbackAncestor)
    }
  }

  function refreshAndFlushPendingRootForNode(node) {
    if (stopped || overflowed) {
      return false
    }
    var task = findPendingRootTask(node)
    if (!task) {
      return
    }
    if (!refreshPendingRootTask(task)) {
      return false
    }
    var overflowCountBeforeFlush = overflowCount
    if (
      processPendingRootTasks(
        getCurrentTime() + MUTATION_SERIALIZATION_FLUSH_BUDGET_MS,
        true
      )
    ) {
      return true
    }
    if (
      overflowed ||
      overflowCount > overflowCountBeforeFlush
    ) {
      return false
    }
    // attachShadow() returns to application code synchronously. If the
    // rebuilt host cannot be published in this bounded drain, later shadow
    // mutations could overtake or be filtered behind the unpublished host.
    // Replace the baseline instead of leaving that dependency pending.
    return handleOverflow({
      reason: 'dynamic_shadow_pending_host_serialization_budget'
    })
  }

  function refreshPendingRootTask(task, activateDeferredTask) {
    if (!task || task.generation !== generation || task.isCancelled) {
      return true
    }
    if (overflowed) {
      return false
    }
    if (!task.rootNode.isConnected) {
      if (taskRequiresBaselineOnDrop(task)) {
        return handleOverflow({
          reason: 'published_move_cancelled'
        })
      }
      cancelPendingRootTask(task)
      return true
    }

    var parentNode = getParentNode(task.rootNode)
    var parentPendingRootTask = findPendingRootTask(parentNode)
    if (parentPendingRootTask && parentPendingRootTask !== task) {
      if (taskRequiresBaselineOnDrop(task)) {
        markPendingRootTaskPublishedDependency(parentPendingRootTask)
      }
      cancelPendingRootTask(task)
      // The parent serializer may have already walked this branch before the
      // child moved under it. Rebuild the surviving task so it cannot publish
      // a stale subtree after absorbing the child's publication dependency.
      return refreshPendingRootTask(parentPendingRootTask)
    }
    var parentNodePrivacyLevel = getNodePrivacyLevel(
      parentNode,
      configuration.defaultPrivacyLevel
    )
    if (
      parentNodePrivacyLevel === NodePrivacyLevel.HIDDEN ||
      parentNodePrivacyLevel === NodePrivacyLevel.IGNORE
    ) {
      if (taskRequiresBaselineOnDrop(task)) {
        return handleOverflow({
          reason: 'published_move_cancelled'
        })
      }
      cancelPendingRootTask(task)
      return true
    }
    var wasDeferred = task.isDeferred
    if (wasDeferred && !activateDeferredTask) {
      schedulePendingRootTasks()
      return true
    }
    if (
      !wasDeferred &&
      task.refreshCount >= MAX_MUTATION_ROOT_TASK_REFRESH_COUNT
    ) {
      return dropUnpublishedRootTask(
        task,
        taskRequiresBaselineOnDrop(task)
          ? 'published_move_refresh_watermark'
          : 'unpublished_add_serialization_watermark',
        true
      )
    }

    // A refresh supersedes the previous serialization generation. Nodes that
    // are not present in the rebuilt subtree must immediately fall back to
    // their last published parent instead of remaining blocked by a token that
    // can no longer be emitted.
    if (!wasDeferred) {
      task.requiresBaselineOnDrop = taskRequiresBaselineOnDrop(task)
      cancelPublicationToken(task.publicationToken)
    }
    var trackedSerializerTask = createTrackedMutationSerializerTask(
      task.rootNode,
      {
        serializedNodeIds: task.serializedNodeIds,
        parentNodePrivacyLevel: parentNodePrivacyLevel,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController: shadowRootsController
        },
        configuration: configuration,
        requiresBaselineOnDrop: taskRequiresBaselineOnDrop(task)
      }
    )
    task.publicationToken = trackedSerializerTask.publicationToken
    var serializerTask = trackedSerializerTask.serializerTask
    if (!serializerTask) {
      if (taskRequiresBaselineOnDrop(task)) {
        return handleOverflow({
          reason: 'published_move_serialization_failed'
        })
      }
      cancelPendingRootTask(task)
      return true
    }
    if (!wasDeferred) {
      task.refreshCount += 1
    }
    if (serializerTask.isMaxNodeComplexityReached) {
      return dropUnpublishedRootTask(
        task,
        'published_move_serialization_watermark'
      )
    }
    if (
      serializerTask.approxBytes >
      MUTATION_SERIALIZATION_MAX_APPROX_BYTES
    ) {
      return dropUnpublishedRootTask(
        task,
        taskRequiresBaselineOnDrop(task)
          ? 'published_move_serialization_watermark'
          : 'unpublished_add_serialization_watermark',
        true
      )
    }
    if (
      wasDeferred &&
      getRetainedMutationApproxBytes() -
        task.accountedApproxBytes +
        serializerTask.approxBytes >
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
    ) {
      cancelPublicationToken(task.publicationToken)
      task.publicationToken = undefined
      return 'blocked'
    }
    if (
      !updateRetainedRootTaskApproxBytes(
        task,
        serializerTask.approxBytes
      )
    ) {
      return handleOverflow({
        reason: AGGREGATE_RETAINED_MUTATION_WATERMARK,
        mutationApproxBytes: getRetainedMutationApproxBytes()
      })
    }
    if (
      getRetainedMutationApproxBytes() >
      MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
    ) {
      return handleOverflow({
        reason: MUTATION_ROOT_RETAINED_BYTES_WATERMARK
      })
    }
    removeCompletedRootTask(task)
    task.parentId = getSerializedNodeId(parentNode)
    task.nextId = null
    task.serializerTask = serializerTask
    task.isCompleted = false
    task.isCancelled = false
    if (wasDeferred) {
      removeDeferredRootTaskQueueMembership(task)
      task.isActiveSerializerTask = true
      activeRootTaskCount += 1
    } else {
      enqueuePendingRootTask(task)
      schedulePendingRootTasks()
    }
    return true
  }

  function retargetPendingRootTask(task, replacementNode) {
    if (
      !task ||
      task.generation !== generation ||
      task.isCancelled ||
      !replacementNode
    ) {
      return true
    }
    if (
      pendingRootTaskByRootNode.get(task.rootNode) !== task ||
      pendingRootTaskByRootNode.get(replacementNode)
    ) {
      return handleOverflow({ reason: 'published_move_cancelled' })
    }
    pendingRootTaskByRootNode.delete(task.rootNode)
    task.rootNode = replacementNode
    clearLocallyDroppedRootNode(replacementNode)
    pendingRootTaskByRootNode.set(replacementNode, task)
    return refreshPendingRootTask(task)
  }

  function handlePendingRootRemoval(task, node) {
    if (!task || task.generation !== generation) {
      return true
    }
    if (node === task.rootNode) {
      if (task.rootNode.isConnected) {
        return refreshPendingRootTask(task)
      }
      if (taskRequiresBaselineOnDrop(task)) {
        return handleOverflow({
          reason: 'published_move_cancelled'
        })
      }
      cancelPendingRootTask(task)
      return true
    }
    if (!task.rootNode.isConnected) {
      if (taskRequiresBaselineOnDrop(task)) {
        return handleOverflow({
          reason: 'published_move_cancelled'
        })
      }
      cancelPendingRootTask(task)
      return true
    }
    return refreshPendingRootTask(task)
  }

  function cancelPendingRootTask(task) {
    cancelPublicationToken(task.publicationToken)
    releaseMutationGroupDependency(task)
    task.isCancelled = true
    removeDeferredRootTaskQueueMembership(task)
    if (task.isQueued) {
      task.isQueued = false
      pendingRootTaskCount -= 1
      if (pendingRootTaskContinuation === task) {
        pendingRootTaskContinuation = undefined
      }
    }
    pendingRootTaskByRootNode.delete(task.rootNode)
    pendingRootTaskBySequence.delete(task.sequence)
    removeCompletedRootTask(task)
    releaseRetainedRootTask(task)
    advanceEmitSequencePastGaps()
    emitReadyMutationGroups()
  }

  function dropUnpublishedRootTask(
    task,
    recoveryReason,
    shouldRecoverUnpublishedRoot
  ) {
    if (
      taskRequiresBaselineOnDrop(task) ||
      shouldRecoverUnpublishedRoot
    ) {
      return handleOverflow({
        reason:
          recoveryReason || 'published_move_serialization_watermark'
      })
    }
    markLocallyDroppedRootNode(task.rootNode)
    cancelPendingRootTask(task)
    return true
  }

  function dropUnadmittedRootNode(
    node,
    publicationToken,
    requiresBaselineOnDrop,
    recoveryReason,
    shouldRecoverUnpublishedRoot
  ) {
    if (requiresBaselineOnDrop || shouldRecoverUnpublishedRoot) {
      cancelPublicationToken(publicationToken)
      return handleOverflow({
        reason:
          recoveryReason || 'published_move_serialization_watermark'
      })
    }
    markLocallyDroppedRootNode(node)
    cancelPublicationToken(publicationToken)
    return true
  }

  function dropMutationGroupTasks(mutationGroup) {
    if (
      stopped ||
      overflowed ||
      !mutationGroup ||
      !pendingRootTaskBySequence.size
    ) {
      return
    }
    var tasks = Array.from(pendingRootTaskBySequence.values()).filter(
      function (task) {
        return task.mutationGroup === mutationGroup
      }
    )
    if (!tasks.length) {
      return
    }
    if (
      tasks.some(function (task) {
        return taskRequiresBaselineOnDrop(task)
      })
    ) {
      return handleOverflow({
        reason: 'published_move_normalization_budget'
      })
    }
    // Mark the whole group before cancellation. Sibling anchors are resolved
    // again immediately before emission, so no eager pending-task scan is
    // needed here.
    tasks.forEach(function (task) {
      markSharedLocallyDroppedRootNode(task.rootNode)
      locallyDroppedRootNodes.add(task.rootNode)
    })
    tasks.forEach(function (task) {
      cancelPendingRootTask(task)
    })
  }

  function markPendingRootTaskPublishedDependency(task) {
    if (
      task &&
      task.generation === generation &&
      !task.isCancelled
    ) {
      task.requiresBaselineOnDrop = true
    }
  }

  function taskRequiresBaselineOnDrop(task) {
    return Boolean(task && task.requiresBaselineOnDrop)
  }

  function markLocallyDroppedRootNode(node) {
    markSharedLocallyDroppedRootNode(node)
    locallyDroppedRootNodes.add(node)
  }

  function markSharedLocallyDroppedRootNode(node) {
    var dependencyState = getMutationDependencyState(
      shadowRootsController
    )
    if (dependencyState) {
      dependencyState.$rLocallyDroppedRoots.add(node)
    }
  }

  function clearLocallyDroppedRootNode(node) {
    locallyDroppedRootNodes.delete(node)
    var dependencyState = getMutationDependencyState(
      shadowRootsController
    )
    if (dependencyState) {
      dependencyState.$rLocallyDroppedRoots.delete(node)
    }
  }

  function removeDeferredRootTaskQueueMembership(task) {
    if (!task || !task.isDeferred) {
      return
    }
    task.isDeferred = false
    deferredRootTaskCount = Math.max(deferredRootTaskCount - 1, 0)
  }

  function schedulePendingRootTasks() {
    if (stopped || overflowed || scheduledFlush || !pendingRootTaskCount) {
      return
    }
    scheduledFlush = setTimeout(function () {
      scheduledFlush = undefined
      processPendingRootTasks(
        getCurrentTime() + MUTATION_SERIALIZATION_SLICE_MS,
        false
      )
    }, 0)
  }

  function processPendingRootTasks(deadline, flushCompletedTasks) {
    clearScheduledFlush()
    if (stopped || overflowed) {
      return true
    }
    if (flushCompletedTasks && completedRootTasksBySequence.size) {
      emitCompletedRootTasks()
    }
    if (!pendingRootTaskCount) {
      return true
    }

    var serializationStart = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? getCurrentTime()
      : 0

    while (pendingRootTaskCount) {
      var task = dequeuePendingRootTask()
      if (!task) {
        break
      }
      if (task.generation !== generation) {
        continue
      }

      if (task.isDeferred) {
        if (activeRootTaskCount >= MAX_PENDING_MUTATION_ROOT_TASKS) {
          emitCompletedRootTasks()
          if (stopped || overflowed) {
            return false
          }
          if (activeRootTaskCount >= MAX_PENDING_MUTATION_ROOT_TASKS) {
            return handleOverflow({
              reason: MUTATION_ROOT_ADMISSION_WATERMARK
            })
          }
        }
        var activationResult = refreshPendingRootTask(task, true)
        if (activationResult === 'blocked') {
          emitCompletedRootTasks()
          if (stopped || overflowed) {
            return false
          }
          activationResult = refreshPendingRootTask(task, true)
          if (activationResult === 'blocked') {
            return handleOverflow({
              reason: MUTATION_ROOT_RETAINED_BYTES_WATERMARK,
              mutationApproxBytes: getRetainedMutationApproxBytes()
            })
          }
        }
        if (activationResult === false) {
          return false
        }
        if (task.isCancelled || !task.isActiveSerializerTask) {
          continue
        }
      }

      var completed = task.serializerTask.advance(
        deadline,
        MUTATION_SERIALIZATION_MAX_NODE_COUNT,
        MUTATION_SERIALIZATION_MAX_APPROX_BYTES
      )
      if (task.generation !== generation) {
        continue
      }
      if (
        !updateRetainedRootTaskApproxBytes(
          task,
          task.serializerTask.approxBytes
        )
      ) {
        handleOverflow({
          reason: AGGREGATE_RETAINED_MUTATION_WATERMARK,
          mutationApproxBytes: getRetainedMutationApproxBytes()
        })
        return false
      }

      if (
        !completed &&
        (task.serializerTask.isMaxNodeCountReached ||
          task.serializerTask.isMaxApproxBytesReached ||
          task.serializerTask.isMaxDepthReached ||
          task.serializerTask.isMaxNodeComplexityReached)
      ) {
        // A new subtree that only exceeds the mutation record's node/byte
        // watermarks may still fit in the larger full-snapshot budget. Replace
        // the baseline so a static oversized root is not lost forever. Depth
        // and per-node complexity use the same hard limits in a full snapshot,
        // so those remain a bounded local drop.
        var shouldRecoverUnpublishedRoot =
          !task.serializerTask.isMaxDepthReached &&
          !task.serializerTask.isMaxNodeComplexityReached &&
          (task.serializerTask.isMaxNodeCountReached ||
            task.serializerTask.isMaxApproxBytesReached)
        if (
          !dropUnpublishedRootTask(
            task,
            taskRequiresBaselineOnDrop(task)
              ? 'published_move_serialization_watermark'
              : 'unpublished_add_serialization_watermark',
            shouldRecoverUnpublishedRoot
          )
        ) {
          return false
        }
        continue
      }
      if (completed) {
        task.isCompleted = true
        completedRootTasksBySequence.set(task.sequence, task)
      }
      if (
        getRetainedMutationApproxBytes() >
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
      ) {
        emitCompletedRootTasks()
        if (
          getRetainedMutationApproxBytes() >
          MAX_PENDING_MUTATION_ROOT_APPROX_BYTES
        ) {
          handleOverflow({
            reason: MUTATION_ROOT_RETAINED_BYTES_WATERMARK
          })
          return false
        }
      }

      if (completed) {
        if (getCurrentTime() >= deadline) {
          break
        }
      } else {
        enqueuePendingRootTaskContinuation(task)
        if (getCurrentTime() >= deadline) {
          break
        }
      }
    }

    if (completedRootTasksBySequence.size) {
      emitCompletedRootTasks()
    }

    if (pendingRootTaskCount) {
      schedulePendingRootTasks()
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && mutationPerfCb) {
      mutationPerfCb({
        mutationSerializationCount: 1,
        mutationSerializationDuration: getCurrentTime() - serializationStart
      })
    }
    return pendingRootTaskCount === 0
  }

  function clearScheduledFlush() {
    if (scheduledFlush) {
      clearTimeout(scheduledFlush)
      scheduledFlush = undefined
    }
  }

  function emitCompletedRootTasks() {
    if (overflowed || !completedRootTasksBySequence.size) {
      return
    }

    var readyTasks = []
    advanceEmitSequencePastGaps()
    while (nextEmitSequence < nextTaskSequence) {
      var nextTask = completedRootTasksBySequence.get(nextEmitSequence)
      if (!nextTask) {
        break
      }
      readyTasks.push(nextTask)
      completedRootTasksBySequence.delete(nextEmitSequence)
      nextEmitSequence += 1
    }

    if (!readyTasks.length) {
      if (pendingRootTaskCount || deferredRootTaskCount) {
        schedulePendingRootTasks()
      }
      return
    }

    var emissionGeneration = generation
    var ungroupedAdds = []
    var ungroupedAddsApproxBytes = 64
    var queuedRootParentIds = new Map()
    var siblingResolutionState = [
      getCurrentTime() + MUTATION_NORMALIZATION_MAX_DURATION_MS,
      0,
      false,
      new Map(),
      new Map()
    ]

    for (
      var resolutionIndex = 0;
      resolutionIndex < readyTasks.length;
      resolutionIndex += 1
    ) {
      var resolutionTask = readyTasks[resolutionIndex]
      resolutionTask.nextId = getNextSibling(
        resolutionTask.rootNode,
        queuedRootParentIds,
        true,
        siblingResolutionState,
        resolutionTask.parentId,
        resolutionTask.sequence
      )
      if (siblingResolutionState[2]) {
        handleOverflow({
          reason: 'mutation_sibling_resolution_watermark',
          mutationNodeCount: siblingResolutionState[1]
        })
        return
      }
      queuedRootParentIds.set(
        resolutionTask.serializerTask.serializedNode.id,
        resolutionTask.parentId
      )
    }

    function isEmissionGenerationActive() {
      return (
        !stopped &&
        !overflowed &&
        generation === emissionGeneration
      )
    }

    function emitUngroupedAdds() {
      if (!ungroupedAdds.length) {
        return true
      }
      var adds = ungroupedAdds
      var approxBytes = ungroupedAddsApproxBytes
      ungroupedAdds = []
      ungroupedAddsApproxBytes = 64
      var payload = {
        adds: adds,
        removes: [],
        texts: [],
        attributes: []
      }
      approxBytesByMutationPayload.set(payload, approxBytes)
      mutationCallback(payload)
      return isEmissionGenerationActive()
    }

    for (
      var readyTaskIndex = 0;
      readyTaskIndex < readyTasks.length;
      readyTaskIndex += 1
    ) {
      if (!isEmissionGenerationActive()) {
        return
      }
      var task = readyTasks[readyTaskIndex]
      pendingRootTaskByRootNode.delete(task.rootNode)
      pendingRootTaskBySequence.delete(task.sequence)
      var activeMutationGroup =
        task.mutationGroup &&
        isActiveMutationGroup(task.mutationGroup) &&
        !task.mutationGroup.canceled
          ? task.mutationGroup
          : undefined
      if (activeMutationGroup) {
        // Preserve callback order across the async serializer. A later pure
        // add can reference a node published by this atomic group through its
        // nextId, so it must not overtake the group's remove + add payload.
        if (!emitUngroupedAdds()) {
          return
        }
        transferRetainedRootTaskToMutationGroup(
          task,
          activeMutationGroup
        )
      } else {
        ungroupedAddsApproxBytes += task.accountedApproxBytes
        releaseRetainedRootTask(task)
      }
      var add = {
        nextId: task.nextId,
        parentId: task.parentId,
        node: task.serializerTask.serializedNode
      }
      task.publicationToken.$rQueued = true
      publicationTokenByMutationAdd.set(add, task.publicationToken)
      task.publicationToken = undefined
      if (activeMutationGroup) {
        activeMutationGroup.payload.adds.push(add)
      } else {
        ungroupedAdds.push(add)
      }
      releaseMutationGroupDependency(task)
      if (activeMutationGroup) {
        emitReadyMutationGroups()
        if (!isEmissionGenerationActive()) {
          return
        }
      }
    }

    if (!emitUngroupedAdds()) {
      return
    }
    // An attribute/text-only group can be waiting behind an earlier
    // ungrouped serializer task even though it has no tasks of its own.
    emitReadyMutationGroups()
  }

  function removeCompletedRootTask(task) {
    completedRootTasksBySequence.delete(task.sequence)
  }

  function updateRetainedRootTaskApproxBytes(task, approxBytes) {
    if (!task.isRetained) {
      return true
    }
    retainedRootTaskApproxBytes +=
      approxBytes - task.accountedApproxBytes
    task.accountedApproxBytes = approxBytes
    return updateRetainedMutationResourceBudget()
  }

  function releaseRetainedRootTask(task) {
    if (!task.isRetained) {
      return
    }
    task.isRetained = false
    retainedRootTaskApproxBytes = Math.max(
      0,
      retainedRootTaskApproxBytes - task.accountedApproxBytes
    )
    task.accountedApproxBytes = 0
    updateRetainedMutationResourceBudget()
    releaseActiveRootTask(task)
    releaseDeferredRootTaskOutstanding(task)
  }

  function releaseActiveRootTask(task) {
    if (!task || !task.isActiveSerializerTask) {
      return
    }
    task.isActiveSerializerTask = false
    activeRootTaskCount = Math.max(activeRootTaskCount - 1, 0)
  }

  function releaseDeferredRootTaskOutstanding(task) {
    if (!task || !task.wasDeferred) {
      return
    }
    task.wasDeferred = false
    deferredRootTaskOutstandingCount = Math.max(
      deferredRootTaskOutstandingCount - 1,
      0
    )
  }

  function updateRetainedMutationResourceBudget() {
    if (!mutationResourceBudget) {
      return true
    }
    var approxBytes = getRetainedMutationApproxBytes()
    if (!approxBytes) {
      if (retainedMutationBudgetReservation) {
        retainedMutationBudgetReservation()
        retainedMutationBudgetReservation = undefined
      }
      return true
    }
    if (!retainedMutationBudgetReservation) {
      retainedMutationBudgetReservation = mutationResourceBudget.reserve(
        MUTATION_RESOURCE_RETAINED,
        { approxBytes: approxBytes }
      )
      return Boolean(retainedMutationBudgetReservation)
    }
    return retainedMutationBudgetReservation.update({
      approxBytes: approxBytes
    })
  }

  function createTrackedMutationSerializerTask(node, serializationOptions) {
    var publicationToken = createMutationAddPublicationToken(
      shadowRootsController,
      serializationOptions.requiresBaselineOnDrop
    )
    var serializationContext = assign(
      {},
      serializationOptions.serializationContext,
      {
        publicationToken: publicationToken
      }
    )
    var serializerTask = createMutationSerializerTask(
      node,
      assign({}, serializationOptions, {
        serializationContext: serializationContext,
        onSerializedNode: function (node, parentNode) {
          // A previously degraded node can later be published as a descendant
          // of a wider root task. Clear both local markers for every staged
          // node, not only when that node becomes a root task itself.
          clearLocallyDroppedRootNode(node)
          if (mutationNodeSerializationCb) {
            mutationNodeSerializationCb(
              node,
              parentNode,
              publicationToken
            )
          }
        }
      })
    )
    return {
      serializerTask: serializerTask,
      publicationToken: publicationToken
    }
  }

  function cancelPublicationToken(publicationToken) {
    cancelMutationAddPublicationToken(publicationToken)
  }

  function advanceEmitSequencePastGaps() {
    while (
      nextEmitSequence < nextTaskSequence &&
      !pendingRootTaskBySequence.has(nextEmitSequence)
    ) {
      nextEmitSequence += 1
    }
  }

  function enqueuePendingRootTask(task) {
    if (task.isQueued) {
      return
    }
    if (!pendingRootTaskCount) {
      pendingRootTasks = []
      pendingRootTaskHead = 0
    }
    task.isQueued = true
    pendingRootTaskCount += 1
    pendingRootTasks.push(task)
  }

  function enqueuePendingRootTaskContinuation(task) {
    if (task.isQueued) {
      return
    }
    task.isQueued = true
    pendingRootTaskCount += 1
    pendingRootTaskContinuation = task
  }

  function dequeuePendingRootTask() {
    if (pendingRootTaskContinuation) {
      var continuation = pendingRootTaskContinuation
      pendingRootTaskContinuation = undefined
      if (continuation.isQueued) {
        continuation.isQueued = false
        pendingRootTaskCount -= 1
        return continuation
      }
    }
    while (pendingRootTaskHead < pendingRootTasks.length) {
      var task = pendingRootTasks[pendingRootTaskHead++]
      if (!task.isQueued) {
        continue
      }
      task.isQueued = false
      pendingRootTaskCount -= 1
      compactPendingRootTaskQueue()
      if (!task.isCancelled) {
        return task
      }
    }
  }

  function compactPendingRootTaskQueue() {
    if (
      pendingRootTaskHead >= 256 &&
      pendingRootTaskHead * 2 >= pendingRootTasks.length
    ) {
      pendingRootTasks = pendingRootTasks.slice(pendingRootTaskHead)
      pendingRootTaskHead = 0
    }
  }

  function getNextSibling(
    node,
    serializedNodeIds,
    requireQueued,
    resolutionState,
    expectedParentId,
    taskSequence
  ) {
    if (
      requireQueued &&
      getSerializedNodeId(getParentNode(node)) !== expectedParentId
    ) {
      // The native move is still waiting in MutationBatch. Emit the old-parent
      // add without a cross-parent anchor; the later normalized move will place
      // it under the current parent.
      return null
    }
    var nextSibling = node.nextSibling
    var visitedNodes = resolutionState ? [] : undefined
    while (nextSibling) {
      if (
        resolutionState &&
        consumeSiblingResolutionBudget(resolutionState)
      ) {
        return null
      }
      if (hasSerializedNode(nextSibling)) {
        var nextSiblingId = getSerializedNodeId(nextSibling)
        var pendingNextSiblingTask = requireQueued
          ? findPendingRootTask(nextSibling)
          : undefined
        var serializedSiblingIsQueuedInCurrentParent = Boolean(
          serializedNodeIds && serializedNodeIds.has(nextSiblingId)
        )
        if (
          serializedSiblingIsQueuedInCurrentParent &&
          requireQueued
        ) {
          serializedSiblingIsQueuedInCurrentParent =
            serializedNodeIds.get(nextSiblingId) ===
            getSerializedNodeId(getParentNode(nextSibling))
        }
        if (
          !locallyDroppedRootNodes.has(nextSibling) &&
          (!pendingNextSiblingTask ||
            serializedSiblingIsQueuedInCurrentParent) &&
          (serializedSiblingIsQueuedInCurrentParent ||
            !isIgnoredNode(nextSibling, requireQueued))
        ) {
          return finalizeSiblingResolution(
            resolutionState,
            visitedNodes,
            nextSiblingId,
            Infinity
          )
        }
        var cachedMinSequence =
          resolutionState &&
          resolutionState[4].get(nextSibling)
        if (
          cachedMinSequence !== undefined &&
          cachedMinSequence >= taskSequence
        ) {
          return finalizeSiblingResolution(
            resolutionState,
            visitedNodes,
            resolutionState[3].get(nextSibling),
            cachedMinSequence
          )
        }
        if (visitedNodes) {
          visitedNodes.push(
            nextSibling,
            pendingNextSiblingTask
              ? pendingNextSiblingTask.sequence
              : Infinity
          )
        }
      } else if (visitedNodes) {
        var cachedIgnoredMinSequence =
          resolutionState[4].get(nextSibling)
        if (
          cachedIgnoredMinSequence !== undefined &&
          cachedIgnoredMinSequence >= taskSequence
        ) {
          return finalizeSiblingResolution(
            resolutionState,
            visitedNodes,
            resolutionState[3].get(nextSibling),
            cachedIgnoredMinSequence
          )
        }
        visitedNodes.push(nextSibling, Infinity)
      }
      nextSibling = nextSibling.nextSibling
    }
    return finalizeSiblingResolution(
      resolutionState,
      visitedNodes,
      null,
      Infinity
    )
  }

  function finalizeSiblingResolution(
    resolutionState,
    visitedNodes,
    nextId,
    minPendingSequence
  ) {
    if (!resolutionState) {
      return nextId
    }
    for (
      var index = visitedNodes.length - 2;
      index >= 0;
      index -= 2
    ) {
      if (consumeSiblingResolutionBudget(resolutionState)) {
        return null
      }
      minPendingSequence = Math.min(
        minPendingSequence,
        visitedNodes[index + 1]
      )
      resolutionState[3].set(visitedNodes[index], nextId)
      resolutionState[4].set(visitedNodes[index], minPendingSequence)
    }
    return nextId
  }

  function consumeSiblingResolutionBudget(resolutionState) {
    resolutionState[1] += 1
    if (
      resolutionState[1] >= MAX_PENDING_MUTATION_ROOT_TASKS * 32 ||
      (resolutionState[1] %
          MUTATION_NORMALIZATION_TIME_CHECK_INTERVAL ===
        0 &&
        getCurrentTime() >= resolutionState[0])
    ) {
      resolutionState[2] = true
      return true
    }
    return false
  }

  function isIgnoredNode(node, includeQueued) {
    try {
      return isNodeIgnored(node, includeQueued)
    } catch (_) {
      return true
    }
  }
}

function getCurrentTime() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

function traverseRemovedShadowDom(
  removedNode,
  shadowDomRemovedCallback,
  traversalState
) {
  if (traversalState.deadline === undefined) {
    traversalState.deadline =
      getCurrentTime() + MAX_REMOVED_SUBTREE_TRAVERSAL_DURATION_MS
  }
  // Keep one cursor frame per depth level instead of pushing every child of a
  // wide subtree. The stack itself is therefore bounded by the same node
  // watermark as the traversal.
  var traversalStack = [
    {
      node: removedNode,
      entered: false
    }
  ]
  while (traversalStack.length) {
    var frame = traversalStack[traversalStack.length - 1]
    if (frame.entered) {
      if (frame.nextChild) {
        var nextChild = frame.nextChild
        frame.nextChild = nextChild.nextSibling
        traversalStack.push({
          node: nextChild,
          entered: false
        })
        continue
      }
      if (frame.shadowRoot) {
        var shadowRoot = frame.shadowRoot
        frame.shadowRoot = undefined
        traversalStack.push({
          node: shadowRoot,
          entered: false
        })
        continue
      }
      traversalStack.pop()
      continue
    }
    if (
      traversalState.nodeCount >=
        MAX_REMOVED_SUBTREE_TRAVERSAL_NODES ||
      (traversalState.nodeCount %
        REMOVED_SUBTREE_TIME_CHECK_INTERVAL ===
        0 &&
        getCurrentTime() >= traversalState.deadline)
    ) {
      return false
    }
    frame.entered = true
    traversalState.nodeCount += 1
    var node = frame.node
    if (isNodeShadowHost(node)) {
      shadowDomRemovedCallback(node.shadowRoot)
      frame.shadowRoot = node.shadowRoot
    }
    frame.nextChild = node.firstChild
  }
  return true
}
