import {
  timeStampNow,
  getScrollX,
  getScrollY,
  assign,
  addTelemetryDebug,
  getParentNode,
  setInterval,
  clearInterval
} from '@cloudcare/browser-core'
import { getViewportDimension } from '../../initViewportObservable'
import {
  SESSION_REPLAY_TIME_ANCHOR_INTERVAL,
  SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
  SESSION_REPLAY_TIME_ANCHOR_TAG
} from '../timeAnchor'

export {
  SESSION_REPLAY_TIME_ANCHOR_INTERVAL,
  SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
  SESSION_REPLAY_TIME_ANCHOR_TAG
} from '../timeAnchor'

import { RecordType, IncrementalSource } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import {
  createMutationSerializerTask,
  SerializationContextStatus,
  getSerializedNodeApproxBytes,
  SERIALIZATION_MAX_NODE_COUNT,
  SERIALIZATION_MAX_APPROX_BYTES,
} from './serialize'
import { initInputObserver, initObservers } from './observers'

import { getVisualViewport } from './viewports'
import { assembleIncrementalSnapshot } from './utils'
import { createElementsScrollPositions } from './elementsScrollPositions'
import { initShadowRootsController } from './shadowRootsController'
import { createCanvasObserver } from './canvasObserver'
import { createCanvasEncodeBridge } from './canvasEncodeBridge'
import { isWebGLReplayCanvas } from './canvasContext'
import {
  createNoopObserver,
  createSessionReplayWebGLRuntime
} from './canvasWebGLPluginHost'
import { startCanvasCommandCapture } from './canvasCommandObserver'
import {
  getSerializedCanvasNodes,
  getSerializedCanvasNodesSnapshot,
  getSerializedNodeId,
  startSerializedCanvasTracking,
  MAX_SERIALIZED_NODE_ANCESTOR_DEPTH
} from './serializationUtils'
import {
  cancelMutationAddPublicationToken,
  consumeMutationAddPublicationToken,
  consumeMutationRemoveSourceNode,
  createMutationAddPublicationToken,
  getMutationAddPublicationToken,
  getMutationRemoveSourceNode,
  publishMutationAddPublicationToken,
  registerMutationAddPublicationToken
} from './mutationObserver'
import { createMutationResourceBudget } from './mutationResourceBudget'
import { getNodePrivacyLevel } from './privacy'
import { startContinuousCanvasSnapshotLoop } from './canvasContinuousScheduler'

var MUTATION_EMIT_DELAY_MS = 16
var MAX_MUTATION_EMIT_APPROX_BYTES = 200000
var MUTATION_ADMISSION_RETRY_DELAY_MS = 32
var MUTATION_ADMISSION_DRAIN_SLICE_MS = 4
var MUTATION_ADMISSION_DRAIN_SLICE_APPROX_BYTES = 256 * 1024
var MUTATION_SOURCE_BOUNDARY_FLUSH_BUDGET_MS = 12
var MAX_PENDING_MUTATION_ADMISSION_PAYLOADS = 512
var MAX_PENDING_MUTATION_ADMISSION_APPROX_BYTES = 32 * 1024 * 1024
var DYNAMIC_SHADOW_ROOT_SERIALIZATION_MAX_NODE_COUNT = 5000
var DYNAMIC_SHADOW_ROOT_SERIALIZATION_MAX_APPROX_BYTES =
  MAX_MUTATION_EMIT_APPROX_BYTES - 1024
var INITIAL_FULL_SNAPSHOT_SERIALIZATION_SLICE_MS = 8
var FULL_SNAPSHOT_SERIALIZATION_SLICE_MS = 4
// The churn fallback runs without yielding so the baseline cannot mix DOM
// generations. Keep the whole transaction within one frame.
var FULL_SNAPSHOT_SYNCHRONOUS_FINALIZATION_BUDGET_MS = 12
// Initial snapshots may need several serializer watermarks, but the complete
// record must still fit below the segment layer's 4 MiB pending-raw budget.
var FULL_SNAPSHOT_SERIALIZATION_MAX_NODE_COUNT =
  SERIALIZATION_MAX_NODE_COUNT * 4
var FULL_SNAPSHOT_SERIALIZATION_MAX_APPROX_BYTES =
  SERIALIZATION_MAX_APPROX_BYTES * 4 - 64 * 1024
var FULL_SNAPSHOT_MAX_RESTART_COUNT = 3
var FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS = 1000
var FULL_SNAPSHOT_MAX_WALL_DURATION_MS = 30000
var FULL_SNAPSHOT_MUTATION_QUIET_DELAY_MS = 250
export var MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT = 64
var FULL_SNAPSHOT_CANVAS_BASELINE_TOTAL_TIMEOUT_MS = 2000
var FULL_SNAPSHOT_CANVAS_BASELINE_ITEM_TIMEOUT_MS = 1000
var CANVAS_DEBUG_HISTORY_LIMIT = 200
var DOM_MUTATION_DEBUG_HISTORY_LIMIT = 20
var DOM_MUTATION_DEBUG_SAMPLE_LIMIT = 5
export var MAX_DEFERRED_RECORDS = 100
export var MAX_DEFERRED_RECORD_APPROX_BYTES = 512 * 1024

function shouldUseCommandCapture(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling === 'all'
  )
}

function shouldUseContinuousCanvasSnapshot(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling !== 'all'
  )
}

function isDomMutationRecord(record) {
  return (
    record &&
    record.type === RecordType.IncrementalSnapshot &&
    record.data &&
    record.data.source === IncrementalSource.Mutation
  )
}

function isStatefulDeferredRecord(record) {
  return (
    record &&
    (record.type === RecordType.Focus ||
      record.type === RecordType.VisualViewport ||
      (record.type === RecordType.IncrementalSnapshot &&
        record.data &&
        (record.data.source === IncrementalSource.CanvasMutation ||
          record.data.source === IncrementalSource.StyleSheetRule ||
          record.data.source === IncrementalSource.Input ||
          record.data.source === IncrementalSource.Scroll ||
          record.data.source === IncrementalSource.MediaInteraction ||
          record.data.source === IncrementalSource.ViewportResize)))
  )
}

function reportWebGLReplayFailure(phase, error) {
  addTelemetryDebug(phase, { error: String(error) })
}

export function record(options) {
  var rawEmit = options.emit
  var rawEmitBaseline = options.$rEmitBaseline
  // runtime checks for user options
  if (!rawEmit) {
    throw new Error('emit function is required')
  }
  var configuration = options.configuration
  var initializationCleanupTasks = []
  var recordStopping = false
  var recordStopped = false

  function registerInitializationCleanup(cleanupTask) {
    if (typeof cleanupTask === 'function') {
      initializationCleanupTasks.push(cleanupTask)
    }
  }

  function abortRecorderInitialization(reason, initializationError) {
    recordStopping = true
    recordStopped = true
    var firstCleanupError
    initializationCleanupTasks
      .slice()
      .reverse()
      .forEach(function (cleanupTask) {
        try {
          cleanupTask()
        } catch (error) {
          if (!firstCleanupError) {
            firstCleanupError = error
          }
        }
      })
    initializationCleanupTasks = []
    addTelemetryDebug('Session Replay recorder initialization failed.', {
      reason: reason,
      error: String(initializationError || firstCleanupError)
    })
    if (options.onFullSnapshotFailure) {
      try {
        options.onFullSnapshotFailure(reason)
      } catch (error) {
        addTelemetryDebug(
          'Session Replay recorder initialization failure callback failed.',
          {
            reason: reason,
            error: String(error)
          }
        )
      }
    }
    return createInactiveRecorder()
  }

  var stopSerializedCanvasTracking
  try {
    stopSerializedCanvasTracking =
      shouldUseCommandCapture(configuration) ||
      shouldUseContinuousCanvasSnapshot(configuration)
        ? startSerializedCanvasTracking()
        : function () {}
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(stopSerializedCanvasTracking)
  var suppressRecordsUntilFullSnapshot = false
  var deferredRecords = []
  var deferredRecordsApproxBytes = 0
  var previousReplayTreeRecords = []
  var previousReplayTreeRecordsApproxBytes = 0
  var previousReplayTreeLastRecordTimestamp
  var previousReplayTreeAdmissionActive = false
  var captureRecordsAgainstPreviousReplayTree = false
  var deferredRecordAdmissionTimeout
  var mutationAdmissionEmitInProgress = false
  var mutationPublicationBarrier
  var lastEmitWasLocallyBackpressured = false

  function deferNonDomRecord(
    record,
    mutationAdmissionBarrier,
    insertBeforeLaterBarrier
  ) {
    var recordApproxBytes = estimateJsonValueBytes(
      record,
      MAX_DEFERRED_RECORD_APPROX_BYTES
    )
    if (recordApproxBytes > MAX_DEFERRED_RECORD_APPROX_BYTES) {
      handleDeferredRecordLoss(record)
      return false
    }
    var evictedStatefulRecord
    while (
      deferredRecords.length &&
      (deferredRecords.length >= MAX_DEFERRED_RECORDS ||
        deferredRecordsApproxBytes + recordApproxBytes >
          MAX_DEFERRED_RECORD_APPROX_BYTES)
    ) {
      var removedEntry = deferredRecords.shift()
      deferredRecordsApproxBytes -= removedEntry.$rApproxBytes
      if (
        !evictedStatefulRecord &&
        isStatefulDeferredRecord(removedEntry.$rRecord)
      ) {
        evictedStatefulRecord = removedEntry.$rRecord
      }
    }
    if (evictedStatefulRecord) {
      handleDeferredRecordLoss(evictedStatefulRecord)
      return false
    }
    if (mutationAdmissionBarrier) {
      // Once a non-DOM record observes this exact boundary, later pure adds
      // must not be folded into it and move ahead of the observed state.
      mutationAdmissionBarrier.$rReferencedByDeferredRecord = true
    }
    var deferredEntry = {
      $rRecord: record,
      $rApproxBytes: recordApproxBytes,
      // Keep the exact structural boundary that was pending when this
      // record was observed. The drain uses it to interleave input/CSSOM
      // and other node-dependent state after its add, but before later DOM
      // mutations.
      $rMutationAdmissionBarrier: mutationAdmissionBarrier
    }
    if (insertBeforeLaterBarrier && mutationAdmissionBarrier) {
      var insertionIndex = deferredRecords.length
      for (
        var deferredIndex = 0;
        deferredIndex < deferredRecords.length;
        deferredIndex += 1
      ) {
        var queuedBarrier =
          deferredRecords[deferredIndex].$rMutationAdmissionBarrier
        if (queuedBarrier && queuedBarrier !== mutationAdmissionBarrier) {
          insertionIndex = deferredIndex
          break
        }
      }
      deferredRecords.splice(insertionIndex, 0, deferredEntry)
    } else {
      deferredRecords.push(deferredEntry)
    }
    deferredRecordsApproxBytes += recordApproxBytes
    return true
  }

  function clearPreviousReplayTreeRecords() {
    previousReplayTreeRecords = []
    previousReplayTreeRecordsApproxBytes = 0
  }

  function resetPreviousReplayTreeRecords() {
    clearPreviousReplayTreeRecords()
    previousReplayTreeLastRecordTimestamp = undefined
  }

  function updatePendingFullSnapshotTimestampFromRecord(record) {
    if (
      !record ||
      typeof record.timestamp !== 'number' ||
      !isFinite(record.timestamp) ||
      typeof pendingFullSnapshotTimestamp !== 'number' ||
      record.timestamp <= pendingFullSnapshotTimestamp
    ) {
      return
    }
    pendingFullSnapshotTimestamp = record.timestamp
    previousReplayTreeLastRecordTimestamp = Math.max(
      typeof previousReplayTreeLastRecordTimestamp === 'number'
        ? previousReplayTreeLastRecordTimestamp
        : 0,
      record.timestamp
    )
    if (
      pendingFullSnapshotBaselineRecords &&
      isStatefulDeferredRecord(record)
    ) {
      // The replacement baseline belongs after every event admitted against
      // the previous replay tree. Stateful changes also invalidate the
      // serialized DOM/CSSOM state; stateless events only need fresh immutable
      // baseline record wrappers, rebuilt immediately before admission.
      pendingFullSnapshotRestartRequested = true
    }
  }

  function queuePreviousReplayTreeRecord(record) {
    var recordApproxBytes = estimateJsonValueBytes(
      record,
      MAX_DEFERRED_RECORD_APPROX_BYTES
    )
    if (recordApproxBytes > MAX_DEFERRED_RECORD_APPROX_BYTES) {
      if (isStatefulDeferredRecord(record)) {
        pendingFullSnapshotCanBeDiscarded = false
        pendingFullSnapshotRestartRequested = true
        return true
      }
      return false
    }
    while (
      previousReplayTreeRecords.length &&
      (previousReplayTreeRecords.length >= MAX_DEFERRED_RECORDS ||
        previousReplayTreeRecordsApproxBytes + recordApproxBytes >
          MAX_DEFERRED_RECORD_APPROX_BYTES)
    ) {
      var removedEntry = previousReplayTreeRecords.shift()
      previousReplayTreeRecordsApproxBytes -= removedEntry.$rApproxBytes
      if (isStatefulDeferredRecord(removedEntry.$rRecord)) {
        // A state gap makes restoring the old tail unsafe. The candidate
        // baseline must complete and supersede it.
        pendingFullSnapshotCanBeDiscarded = false
        pendingFullSnapshotRestartRequested = true
      }
    }
    previousReplayTreeRecords.push({
      $rRecord: record,
      $rApproxBytes: recordApproxBytes
    })
    previousReplayTreeRecordsApproxBytes += recordApproxBytes
    updatePendingFullSnapshotTimestampFromRecord(record)
    return true
  }

  function emitAgainstPreviousReplayTree(record) {
    if (previousReplayTreeRecords.length) {
      return queuePreviousReplayTreeRecord(record)
    }
    if (rawEmit(record) !== false) {
      updatePendingFullSnapshotTimestampFromRecord(record)
      return true
    }
    if (wasLastEmitBackpressured()) {
      return queuePreviousReplayTreeRecord(record)
    }
    if (isStatefulDeferredRecord(record)) {
      pendingFullSnapshotCanBeDiscarded = false
      pendingFullSnapshotRestartRequested = true
      return true
    }
    return false
  }

  function drainPreviousReplayTreeRecords() {
    while (previousReplayTreeRecords.length) {
      var entry = previousReplayTreeRecords[0]
      if (rawEmit(entry.$rRecord) !== false) {
        previousReplayTreeRecords.shift()
        previousReplayTreeRecordsApproxBytes -= entry.$rApproxBytes
        continue
      }
      if (wasLastEmitBackpressured()) {
        return false
      }
      previousReplayTreeRecords.shift()
      previousReplayTreeRecordsApproxBytes -= entry.$rApproxBytes
      if (isStatefulDeferredRecord(entry.$rRecord)) {
        pendingFullSnapshotCanBeDiscarded = false
        pendingFullSnapshotRestartRequested = true
      }
    }
    return true
  }

  function restorePreviousReplayTreeRecords() {
    var records = previousReplayTreeRecords
    clearPreviousReplayTreeRecords()
    records.forEach(function (entry) {
      deferNonDomRecord(entry.$rRecord)
    })
    flushDeferredRecords()
  }

  var emit = function (record) {
    lastEmitWasLocallyBackpressured = false
    if (
      suppressRecordsUntilFullSnapshot &&
      previousReplayTreeAdmissionActive &&
      !isDomMutationRecord(record)
    ) {
      return emitAgainstPreviousReplayTree(record)
    }
    if (
      suppressRecordsUntilFullSnapshot &&
      isDomMutationRecord(record)
    ) {
      // The mutation activity callback already invalidated this mixed-time
      // candidate. Retire the serialized payload locally and let the rebuilt
      // FullSnapshot absorb it; reporting a rejection here would incorrectly
      // classify an intentional suppression as an admission gap.
      return true
    }
    if (
      !suppressRecordsUntilFullSnapshot &&
      !mutationPublicationBarrier &&
      (!deferredRecords.length ||
        (mutationAdmissionEmitInProgress &&
          deferredRecords[0].$rMutationAdmissionBarrier &&
          deferredRecords[0].$rMutationAdmissionBarrier
            .$rPendingAdmission)) &&
      deferredRecordAdmissionTimeout === undefined &&
      (mutationAdmissionEmitInProgress ||
        !pendingMutationAdmissionQueue.length)
    ) {
      if (rawEmit(record) !== false) {
        return true
      }
      if (isDomMutationRecord(record)) {
        return false
      }
      if (wasLastEmitBackpressured()) {
        var wasDeferred = deferNonDomRecord(record)
        if (wasDeferred) {
          // A direct segment rejection has no DOM dependency to trigger its
          // retry. Keep the exact record object (and any encoder-side cached
          // serialization keyed by it) on the shared deferred drain.
          scheduleDeferredRecordAdmissionRetry()
        }
        return wasDeferred
      }
      handleDeferredRecordLoss(record)
      return false
    } else if (
      !suppressRecordsUntilFullSnapshot &&
      isDomMutationRecord(record)
    ) {
      // DOM publication membership is committed only after the segment layer
      // accepts the record. Keep it in the mutation admission queue while
      // post-baseline deferred records drain, so it cannot overtake them.
      lastEmitWasLocallyBackpressured = true
      return false
    } else if (!isDomMutationRecord(record)) {
      var mutationAdmissionBarrier =
        mutationPublicationBarrier ||
        (!suppressRecordsUntilFullSnapshot &&
        pendingMutationAdmissionQueue.length
          ? pendingMutationAdmissionQueue[
              pendingMutationAdmissionQueue.length - 1
            ]
          : undefined)
      return deferNonDomRecord(
        record,
        mutationAdmissionBarrier,
        Boolean(mutationPublicationBarrier)
      )
    }
    return false
  }

  var elementsScrollPositions = createElementsScrollPositions()
  var replayPerformanceStats = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? createReplayPerformanceStats()
    : undefined
  var pendingMutationPayload
  var pendingMutationTimeout
  var pendingMutationAdmissionQueue = []
  var pendingMutationAdmissionApproxBytes = 0
  var pendingMutationAdmissionTimeout
  var pendingFullSnapshotTimeout
  var pendingFullSnapshotTimestamp
  var pendingFullSnapshotCanBeDiscarded = false
  var pendingFullSnapshotRequiresTailDiscard = false
  var pendingFullSnapshotTask
  var pendingFullSnapshotMutationVersion
  var pendingFullSnapshotStartedAt
  var pendingFullSnapshotActiveDuration = 0
  var pendingFullSnapshotRestartCount = 0
  var pendingFullSnapshotRestartRequested = false
  var pendingFullSnapshotSynchronousFallbackAttempted = false
  var pendingFullSnapshotIsInitial = false
  var pendingFullSnapshotBaselineRecords
  var pendingFullSnapshotBaselineMutationVersion
  var fullSnapshotWasPublished = false
  var lastReplayTimeAnchorTimestamp
  function emitReplayTimeAnchor() {
    if (
      !fullSnapshotWasPublished ||
      recordStopping ||
      recordStopped ||
      (options.$rShouldEmitTimeAnchor &&
        !options.$rShouldEmitTimeAnchor())
    ) {
      return
    }
    // A time anchor carries no replay state and is safe to drop. Do not put it
    // on the shared deferred queue: `true` must mean that the segment layer
    // actually admitted it, especially for the final stop boundary.
    if (
      suppressRecordsUntilFullSnapshot ||
      mutationPublicationBarrier ||
      deferredRecords.length ||
      deferredRecordAdmissionTimeout !== undefined ||
      pendingMutationPayload ||
      pendingMutationAdmissionQueue.length ||
      mutationAdmissionEmitInProgress ||
      mutationSourceFlushInProgress
    ) {
      return false
    }
    var timestamp = timeStampNow()
    if (timestamp === lastReplayTimeAnchorTimestamp) {
      return true
    }
    lastEmitWasLocallyBackpressured = false
    var accepted = rawEmit({
      type: SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE,
      timestamp: timestamp,
      data: {
        tag: SESSION_REPLAY_TIME_ANCHOR_TAG,
        payload: {}
      }
    })
    if (accepted === false) {
      return false
    }
    lastReplayTimeAnchorTimestamp = timestamp
    return true
  }
  var replayTimeAnchorIntervalId = setInterval(
    emitReplayTimeAnchor,
    SESSION_REPLAY_TIME_ANCHOR_INTERVAL
  )
  registerInitializationCleanup(function () {
    clearInterval(replayTimeAnchorIntervalId)
  })
  var domMutationVersion = 0
  var mutationActivityTargets = new Set()
  var mutationActivityFlushScheduled = false
  var fullSnapshotCanvasBaselineGeneration = 0
  var publishedNodeParentByNode = new WeakMap()
  var publicationTokenByNode = new WeakMap()
  var pendingNodeParentByNode = new WeakMap()
  var pendingPublicationTokenByNode = new WeakMap()
  var refreshAndFlushPendingRootForNode = function () {}
  var currentFullSnapshotPublicationToken = createPublicationToken()
  var previousPublishedReplayTree
  var inputObserver

  function getPublishedReplayTree() {
    return {
      $rPublishedNodeParentByNode: publishedNodeParentByNode,
      $rPublicationTokenByNode: publicationTokenByNode,
      $rPendingNodeParentByNode: pendingNodeParentByNode,
      $rPendingPublicationTokenByNode: pendingPublicationTokenByNode,
      $rCurrentFullSnapshotPublicationToken:
        currentFullSnapshotPublicationToken
    }
  }

  function restorePreviousPublishedReplayTree() {
    if (!previousPublishedReplayTree) {
      return false
    }
    publishedNodeParentByNode =
      previousPublishedReplayTree.$rPublishedNodeParentByNode
    publicationTokenByNode =
      previousPublishedReplayTree.$rPublicationTokenByNode
    pendingNodeParentByNode =
      previousPublishedReplayTree.$rPendingNodeParentByNode
    pendingPublicationTokenByNode =
      previousPublishedReplayTree.$rPendingPublicationTokenByNode
    currentFullSnapshotPublicationToken =
      previousPublishedReplayTree.$rCurrentFullSnapshotPublicationToken
    previousPublishedReplayTree = undefined
    return true
  }

  function resetPublishedReplayTree() {
    publishedNodeParentByNode = new WeakMap()
    publicationTokenByNode = new WeakMap()
    pendingNodeParentByNode = new WeakMap()
    pendingPublicationTokenByNode = new WeakMap()
    currentFullSnapshotPublicationToken = createPublicationToken()
  }

  function createPublicationToken() {
    return {
      $rPublished: false
    }
  }

  function stageFullSnapshotNodePublication(
    node,
    parentNode,
    publicationToken
  ) {
    publishedNodeParentByNode.set(node, parentNode)
    publicationTokenByNode.set(node, publicationToken)
    observeInputNode(node)
  }

  function stageMutationNodePublication(
    node,
    parentNode,
    publicationToken
  ) {
    var previousPendingToken = pendingPublicationTokenByNode.get(node)
    if (previousPendingToken && previousPendingToken.$rPublished) {
      publishedNodeParentByNode.set(
        node,
        pendingNodeParentByNode.get(node)
      )
      publicationTokenByNode.set(node, previousPendingToken)
    }
    pendingNodeParentByNode.set(node, parentNode)
    pendingPublicationTokenByNode.set(node, publicationToken)
    observeInputNode(node)
    if (
      publicationToken &&
      node.tagName === 'CANVAS'
    ) {
      if (!publicationToken.$rCanvasNodes) {
        publicationToken.$rCanvasNodes = new Set()
      }
      publicationToken.$rCanvasNodes.add(node)
    }
  }

  function observeInputNode(node) {
    if (inputObserver && inputObserver.observeInputNode) {
      inputObserver.observeInputNode(node)
    }
  }

  function isNodePublished(node) {
    if (!node) {
      return false
    }
    var pendingPublicationToken =
      pendingPublicationTokenByNode.get(node)
    if (pendingPublicationToken) {
      if (pendingPublicationToken.$rPublished) {
        return true
      }
      if (!pendingPublicationToken.$rCanceled) {
        return false
      }
    }
    if (!publishedNodeParentByNode.has(node)) {
      return false
    }
    var publicationToken = publicationTokenByNode.get(node)
    return Boolean(publicationToken && publicationToken.$rPublished)
  }

  function wasNodePublishedBeforePendingMutation(node) {
    var publicationToken = publicationTokenByNode.get(node)
    return Boolean(
      publishedNodeParentByNode.has(node) &&
        publicationToken &&
        publicationToken.$rPublished
    )
  }

  function isNodeQueuedOrPublished(node) {
    if (!node) {
      return false
    }
    var pendingPublicationToken =
      pendingPublicationTokenByNode.get(node)
    if (pendingPublicationToken) {
      if (
        pendingPublicationToken.$rPublished ||
        pendingPublicationToken.$rQueued
      ) {
        return true
      }
      // Serializing a newly added ancestor can stage an already-published
      // descendant before the paired remove is normalized.  This is the
      // common DOM shape used by Cocos Creator when it inserts a wrapper and
      // moves its existing GameCanvas into it.  Until the destination add is
      // queued, the node still belongs to the previously published replay
      // tree and must remain eligible for the atomic remove + add transition.
      // A genuinely new node has no previous publication token and therefore
      // still falls through to false below.
    }
    var publicationToken = publicationTokenByNode.get(node)
    return Boolean(
      publicationToken &&
        (publicationToken.$rPublished || publicationToken.$rQueued)
    )
  }

  function getPublishedParent(node, includeQueued) {
    var pendingPublicationToken =
      pendingPublicationTokenByNode.get(node)
    if (
      pendingPublicationToken &&
      (pendingPublicationToken.$rPublished ||
        (includeQueued &&
          pendingPublicationToken.$rQueued &&
          !pendingPublicationToken.$rCanceled))
    ) {
      return pendingNodeParentByNode.get(node)
    }
    return publishedNodeParentByNode.get(node)
  }

  function isNodeInPublishedReplayTree(node, includeQueued) {
    var current = node
    var depth = 0
    while (current) {
      if (
        depth >= MAX_SERIALIZED_NODE_ANCESTOR_DEPTH ||
        (!publishedNodeParentByNode.has(current) &&
          !pendingNodeParentByNode.has(current))
      ) {
        return false
      }
      if (
        !(includeQueued
          ? isNodeQueuedOrPublished(current)
          : isNodePublished(current))
      ) {
        return false
      }
      var publishedParent = getPublishedParent(current, includeQueued)
      var currentParent
      try {
        currentParent = getParentNode(current)
      } catch (_) {
        return false
      }
      if (currentParent !== publishedParent) {
        return false
      }
      current = currentParent
      depth += 1
    }
    return Boolean(node)
  }

  function isNodeInPreviousPublishedReplayTree(node) {
    if (!node || !previousPublishedReplayTree) {
      return false
    }
    var previousParents =
      previousPublishedReplayTree.$rPublishedNodeParentByNode
    var previousTokens =
      previousPublishedReplayTree.$rPublicationTokenByNode
    var current = node
    var depth = 0
    while (current) {
      if (
        depth >= MAX_SERIALIZED_NODE_ANCESTOR_DEPTH ||
        !previousParents.has(current)
      ) {
        return false
      }
      var publicationToken = previousTokens.get(current)
      if (!publicationToken || !publicationToken.$rPublished) {
        return false
      }
      var publishedParent = previousParents.get(current)
      var currentParent
      try {
        currentParent = getParentNode(current)
      } catch (_) {
        return false
      }
      if (currentParent !== publishedParent) {
        return false
      }
      current = currentParent
      depth += 1
    }
    return true
  }

  function publishMutationMembership(mutationPayload) {
    var acceptedPublicationTokens = new Set()
    var publicationTokens = mutationPayload.adds.map(function (add) {
      var publicationToken = consumeMutationAddPublicationToken(add)
      if (publicationToken) {
        acceptedPublicationTokens.add(publicationToken)
      }
      return publicationToken
    })
    mutationPayload.removes.forEach(function (remove) {
      var removedNode = consumeMutationRemoveSourceNode(remove)
      if (removedNode) {
        publishedNodeParentByNode.delete(removedNode)
        publicationTokenByNode.delete(removedNode)
        // A move is encoded as remove + add with the same serialized id.
        // Preserve staged destination membership for any node serialized
        // under an accepted add root, including moved descendants.
        if (
          !acceptedPublicationTokens.has(
            pendingPublicationTokenByNode.get(removedNode)
          )
        ) {
          pendingNodeParentByNode.delete(removedNode)
          pendingPublicationTokenByNode.delete(removedNode)
        }
      }
    })
    publicationTokens.forEach(function (publicationToken) {
      publishMutationAddPublicationToken(publicationToken)
      if (
        publicationToken &&
        publicationToken.$rCanvasNodes &&
        canvasCommandCapture &&
        canvasCommandCapture.$rRetryPublishedCanvas
      ) {
        publicationToken.$rCanvasNodes.forEach(function (canvas) {
          canvasCommandCapture.$rRetryPublishedCanvas(canvas)
        })
      }
      if (publicationToken) {
        publicationToken.$rCanvasNodes = undefined
      }
    })
  }

  function discardMutationMembership(mutationPayload) {
    mutationPayload.removes.forEach(function (remove) {
      consumeMutationRemoveSourceNode(remove)
    })
    mutationPayload.adds.forEach(function (add) {
      var publicationToken = consumeMutationAddPublicationToken(add)
      if (publicationToken && !publicationToken.$rPublished) {
        cancelMutationAddPublicationToken(publicationToken)
      }
      if (publicationToken) {
        publicationToken.$rCanvasNodes = undefined
      }
    })
  }

  function trackDomMutationActivity(target) {
    if (
      suppressRecordsUntilFullSnapshot &&
      previousReplayTreeAdmissionActive
    ) {
      pendingFullSnapshotTimestamp = Math.max(
        typeof pendingFullSnapshotTimestamp === 'number'
          ? pendingFullSnapshotTimestamp
          : 0,
        timeStampNow()
      )
    }
    if (
      suppressRecordsUntilFullSnapshot &&
      pendingFullSnapshotCanBeDiscarded
    ) {
      // DOM mutation payloads are serialized against the pending tree and
      // cannot also be replayed safely against the previous tree. Promote the
      // optional transaction so it cannot abandon after retiring that change.
      pendingFullSnapshotCanBeDiscarded = false
      pendingFullSnapshotRestartRequested = true
    }
    domMutationVersion += 1
    if (
      !target ||
      mutationActivityFlushScheduled ||
      recordStopping ||
      recordStopped
    ) {
      if (target) {
        mutationActivityTargets.add(target)
      }
      return
    }
    mutationActivityTargets.add(target)
    mutationActivityFlushScheduled = true
    setTimeout(function () {
      mutationActivityFlushScheduled = false
      var activeTargets = mutationActivityTargets
      mutationActivityTargets = new Set()
      if (
        activeTargets.size > 1 &&
        !recordStopping &&
        !recordStopped &&
        !suppressRecordsUntilFullSnapshot &&
        !mutationSourceFlushInProgress
      ) {
        flushMutations()
      }
    }, MUTATION_EMIT_DELAY_MS)
  }

  function captureDynamicShadowRoot(shadowRoot, host) {
    if (recordStopping || recordStopped) {
      return
    }
    var hostIsConnected
    try {
      hostIsConnected = host.isConnected
    } catch (_) {
      return
    }
    if (!hostIsConnected) {
      return
    }

    // attachShadow() itself does not enqueue a document MutationRecord. Mark
    // the active full-snapshot transaction dirty so a root attached after its
    // host was traversed cannot be omitted from the published baseline.
    trackDomMutationActivity()
    if (suppressRecordsUntilFullSnapshot) {
      return
    }

    // An unpublished host will be serialized by its pending outer add, which
    // naturally includes the new root. Refresh and synchronously drain the
    // owning document/shadow mutation controller before returning from
    // attachShadow(), so children appended immediately afterwards are
    // observed behind a published host/root boundary.
    if (!isNodeQueuedOrPublished(host)) {
      var pendingHostFlushResult =
        refreshAndFlushPendingRootForNode(host)
      if (
        typeof pendingHostFlushResult === 'undefined' &&
        shadowRootsController.refreshAndFlushPendingRootForNode
      ) {
        pendingHostFlushResult =
          shadowRootsController.refreshAndFlushPendingRootForNode(host)
      }
      if (pendingHostFlushResult === true) {
        // The rebuilt host add contains the empty ShadowRoot inline and its
        // publication token owns the provisional shadow observer. Commit or
        // roll it back before application code can append the first child.
        flushPendingMutations()
      }
      return
    }

    // A host add can still be waiting in the mutation emit buffer here.
    // Resolve that structural dependency before creating the shadow-root add:
    // if the host record is rejected synchronously, accepting a later shadow
    // record would reference a parent id that the replay backend never saw.
    flushPendingMutations()
    if (!isNodeInPublishedReplayTree(host)) {
      return
    }

    var hostPrivacyLevel = getNodePrivacyLevel(
      host,
      configuration.defaultPrivacyLevel
    )
    if (
      hostPrivacyLevel === NodePrivacyLevel.HIDDEN ||
      hostPrivacyLevel === NodePrivacyLevel.IGNORE
    ) {
      return
    }

    var publicationToken = createMutationAddPublicationToken(
      shadowRootsController
    )
    var serializerTask = createMutationSerializerTask(shadowRoot, {
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: shadowRootsController,
        publicationToken: publicationToken
      },
      parentNodePrivacyLevel: hostPrivacyLevel,
      configuration: configuration,
      onSerializedNode: function (node, parentNode) {
        stageMutationNodePublication(
          node,
          parentNode,
          publicationToken
        )
      }
    })
    if (
      !serializerTask ||
      !serializerTask.advance(
        getPerformanceTime() + FULL_SNAPSHOT_SERIALIZATION_SLICE_MS,
        DYNAMIC_SHADOW_ROOT_SERIALIZATION_MAX_NODE_COUNT,
        DYNAMIC_SHADOW_ROOT_SERIALIZATION_MAX_APPROX_BYTES
      ) ||
      serializerTask.isMaxNodeCountReached ||
      serializerTask.isMaxApproxBytesReached ||
      serializerTask.isMaxDepthReached ||
      serializerTask.isMaxNodeComplexityReached
    ) {
      cancelMutationAddPublicationToken(publicationToken)
      beginAdmissionGapRecovery('dynamic_shadow_root_serialization')
      return
    }

    var add = {
      parentId: getSerializedNodeId(host),
      nextId: null,
      node: serializerTask.serializedNode
    }
    publicationToken.$rQueued = true
    registerMutationAddPublicationToken(add, publicationToken)
    mutationCb({
      adds: [add],
      removes: [],
      texts: [],
      attributes: []
    })
    // attachShadow() returns control to the application immediately. Publish
    // the empty root boundary first so synchronous children added by the
    // caller can be observed without ever overtaking their parent root.
    flushPendingMutations()
  }

  var mutationLocalDropTelemetryReported = false
  var updateReplayPerformanceStats = function (delta) {
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      accumulateReplayPerformanceStats(replayPerformanceStats, delta)
    } else if (!mutationLocalDropTelemetryReported) {
      mutationLocalDropTelemetryReported = true
      addTelemetryDebug('Session Replay record discarded.', {
        reason: delta
      })
    }
  }

  var mutationSourceFlushInProgress = false
  var mutationFlushDocumentPending = false
  var mutationSourceFlushContinuationTimeout
  var mutationCb = function (mutation) {
    var mutationMeasurements = measureMutationPayload(mutation)
    if (hasOversizedMutationEntry(mutationMeasurements)) {
      if (hasStructuralMutationEntries(mutation)) {
        // An oversized add/remove cannot be partitioned independently from
        // structural work that may have arrived in another observer callback.
        // A move is reported as remove + add, and emitting only the bounded
        // half would make the player delete a node whose destination was
        // never published.  Discard the complete local recovery window and
        // require a replacement baseline. Mandatory recovery also holds (and
        // eventually discards) the current segment, covering a structural
        // prefix that may already have been admitted before this callback.
        discardPendingMutationPayload()
        discardPendingMutationAdmissions()
        discardMutationMembership(mutation)
        beginAdmissionGapRecovery('oversized_structural_mutation')
        return
      }
      var mutationPartition = partitionMutationPayloadByEntrySize(
        mutation,
        mutationMeasurements
      )
      // Preserve safe work that was already waiting to be emitted, then replace
      // the dropped mutation with a new DOM baseline.  Never merge an
      // indivisible oversized entry into the pending payload: doing so would
      // retain it in debug history and make the segment layer stringify it
      // before eventually rejecting it.
      flushPendingMutations()
      if (hasMutationEntries(mutationPartition.mutation)) {
        pendingMutationPayload = mergeMutationPayloads(
          undefined,
          mutationPartition.mutation,
          mutationPartition.measurements
        )
        flushPendingMutations()
      }
      requestFullSnapshotAfterMutationDrop({
        reason: 'oversized_non_structural_mutation'
      })
      return
    }
    if (
      !mutationSourceFlushInProgress &&
      pendingMutationPayload &&
      shouldFlushPendingMutationPayloadBeforeMerge(
        pendingMutationPayload,
        mutation,
        mutationMeasurements.approxBytes,
        pendingPublicationTokenByNode,
        pendingNodeParentByNode,
        wasNodePublishedBeforePendingMutation
      )
    ) {
      flushPendingMutations()
    }
    pendingMutationPayload = mergeMutationPayloads(
      pendingMutationPayload,
      mutation,
      mutationMeasurements
    )
    scheduleMutationEmit()
  }
  function scheduleMutationEmit() {
    if (pendingMutationTimeout) {
      return
    }
    pendingMutationTimeout = setTimeout(function () {
      pendingMutationTimeout = undefined
      if (mutationFlushDocumentPending) {
        scheduleMutationSourceFlushContinuation()
        return
      }
      flushPendingMutations()
    }, MUTATION_EMIT_DELAY_MS)
  }

  function wasLastEmitBackpressured() {
    return Boolean(
      lastEmitWasLocallyBackpressured ||
        (options.$rWasLastEmitBackpressured &&
          options.$rWasLastEmitBackpressured())
    )
  }

  function scheduleMutationAdmissionRetry() {
    scheduleMutationAdmissionDrain(MUTATION_ADMISSION_RETRY_DELAY_MS)
  }

  function scheduleMutationAdmissionContinuation() {
    scheduleMutationAdmissionDrain(0)
  }

  function scheduleMutationAdmissionDrain(delay) {
    if (
      pendingMutationAdmissionTimeout !== undefined ||
      !pendingMutationAdmissionQueue.length ||
      recordStopping ||
      recordStopped
    ) {
      return
    }
    pendingMutationAdmissionTimeout = setTimeout(function () {
      pendingMutationAdmissionTimeout = undefined
      drainPendingMutationAdmissions()
    }, delay)
  }

  function discardPendingMutationAdmissions() {
    if (pendingMutationAdmissionTimeout !== undefined) {
      clearTimeout(pendingMutationAdmissionTimeout)
      pendingMutationAdmissionTimeout = undefined
    }
    pendingMutationAdmissionQueue.forEach(function (entry) {
      entry.$rPendingAdmission = false
      discardMutationMembership(entry[0])
    })
    pendingMutationAdmissionQueue = []
    pendingMutationAdmissionApproxBytes = 0
  }

  function isPureAddMutationPayload(mutationPayload) {
    return Boolean(
      mutationPayload &&
        mutationPayload.adds.length &&
        !mutationPayload.removes.length &&
        !mutationPayload.texts.length &&
        !mutationPayload.attributes.length
    )
  }

  function tryMergePendingPureAddMutationAdmission(entry) {
    var previousEntry =
      pendingMutationAdmissionQueue[
        pendingMutationAdmissionQueue.length - 1
      ]
    var mutationPayload = entry[0]
    if (
      !previousEntry ||
      previousEntry[3] ||
      previousEntry.$rReferencedByDeferredRecord ||
      !isPureAddMutationPayload(previousEntry[0]) ||
      !isPureAddMutationPayload(mutationPayload) ||
      previousEntry[1] + entry[1] > MAX_MUTATION_EMIT_APPROX_BYTES ||
      pendingMutationAdmissionApproxBytes + entry[1] >
        MAX_PENDING_MUTATION_ADMISSION_APPROX_BYTES
    ) {
      return false
    }

    // The previous record has been assembled but never offered to the
    // segment encoder, so its mutation arrays have not been serialized or
    // cached yet. Keep one exact admission boundary for adjacent independent
    // adds while retaining insertion order and every publication token.
    // Never mutate an attempted entry: a rejected encoder admission can cache
    // its serialized bytes for the exact-object retry contract.
    mutationPayload.adds.forEach(function (addMutation) {
      previousEntry[0].adds.push(addMutation)
    })
    previousEntry[1] += entry[1]
    pendingMutationAdmissionApproxBytes += entry[1]
    return true
  }

  function enqueueMutationEntriesForAdmission(mutationEntries) {
    if (!mutationEntries.length) {
      return
    }
    if (
      suppressRecordsUntilFullSnapshot ||
      recordStopped
    ) {
      mutationEntries.forEach(function (entry) {
        discardMutationMembership(entry[0])
      })
      return
    }
    for (var entryIndex = 0; entryIndex < mutationEntries.length; entryIndex += 1) {
      var entry = mutationEntries[entryIndex]
      if (tryMergePendingPureAddMutationAdmission(entry)) {
        continue
      }
      if (
        pendingMutationAdmissionQueue.length + 1 >
          MAX_PENDING_MUTATION_ADMISSION_PAYLOADS ||
        pendingMutationAdmissionApproxBytes + entry[1] >
          MAX_PENDING_MUTATION_ADMISSION_APPROX_BYTES
      ) {
        var rejectedTail = mutationEntries.slice(entryIndex)
        rejectedTail.forEach(function (rejectedEntry) {
          discardMutationMembership(rejectedEntry[0])
        })
        discardPendingMutationAdmissions()
        beginAdmissionGapRecovery('mutation_admission_queue_overflow')
        return
      }
      entry[2] = assembleIncrementalSnapshot(
        IncrementalSource.Mutation,
        entry[0]
      )
      entry.$rPendingAdmission = true
      pendingMutationAdmissionQueue.push(entry)
      pendingMutationAdmissionApproxBytes += entry[1]
    }
    // Assemble the complete callback batch before attempting admission. A
    // per-entry drain would reset the slice budget for every push and could
    // synchronously consume the full pending-raw window.
    if (pendingMutationAdmissionTimeout === undefined) {
      drainPendingMutationAdmissions()
    }
  }

  function drainPendingMutationAdmissions() {
    if (pendingMutationAdmissionTimeout !== undefined) {
      clearTimeout(pendingMutationAdmissionTimeout)
      pendingMutationAdmissionTimeout = undefined
    }
    if (suppressRecordsUntilFullSnapshot) {
      if (pendingFullSnapshotBaselineRecords) {
        // Serialization is complete and the exact baseline transaction is
        // only waiting for encoder capacity. Keep later DOM records ordered
        // behind it; once the same baseline objects are admitted they can
        // drain normally instead of forcing a re-serialization loop.
        return false
      }
      // The replacement baseline supersedes every queued mutation. Retrying a
      // formerly backpressured record through emit() while suppression is
      // active would look like a permanent rejection and recursively start a
      // second full-snapshot transaction before the first task exists.
      discardPendingMutationAdmissions()
      return false
    }
    if (
      recordStopped ||
      !pendingMutationAdmissionQueue.length
    ) {
      return false
    }
    var drainStartedAt = getPerformanceTime()
    var drainedApproxBytes = 0
    while (pendingMutationAdmissionQueue.length) {
      var entry = pendingMutationAdmissionQueue[0]
      var mutationPayload = entry[0]
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        lastDomMutationForDebug = createDomMutationDebugSummary(
          mutationPayload
        )
        pushCanvasDebugHistoryEntry(
          domMutationHistoryForDebug,
          lastDomMutationForDebug,
          DOM_MUTATION_DEBUG_HISTORY_LIMIT
        )
      }
      entry[3] = true
      var wasAdmitted
      mutationAdmissionEmitInProgress = true
      try {
        wasAdmitted = emit(entry[2])
      } finally {
        mutationAdmissionEmitInProgress = false
      }
      if (wasAdmitted) {
        pendingMutationAdmissionQueue.shift()
        entry.$rPendingAdmission = false
        pendingMutationAdmissionApproxBytes -= entry[1]
        var previousMutationPublicationBarrier =
          mutationPublicationBarrier
        mutationPublicationBarrier = entry
        try {
          publishMutationMembership(mutationPayload)
        } finally {
          mutationPublicationBarrier =
            previousMutationPublicationBarrier
        }
        drainedApproxBytes += entry[1]
        var mutationDrainState = {
          $rStartedAt: drainStartedAt,
          $rApproxBytes: drainedApproxBytes
        }
        var deferredBarrierWasDrained = flushDeferredRecords(
          entry,
          mutationDrainState
        )
        drainedApproxBytes = mutationDrainState.$rApproxBytes
        if (suppressRecordsUntilFullSnapshot || recordStopped) {
          return false
        }
        if (!deferredBarrierWasDrained) {
          // The dependent records use the same time/byte slice and retry
          // scheduler. Mutation admission resumes only after this exact
          // structural barrier has drained.
          return true
        }
        if (
          pendingMutationAdmissionQueue.length &&
          (drainedApproxBytes >=
            MUTATION_ADMISSION_DRAIN_SLICE_APPROX_BYTES ||
            getPerformanceTime() - drainStartedAt >=
              MUTATION_ADMISSION_DRAIN_SLICE_MS)
        ) {
          scheduleMutationAdmissionContinuation()
          return true
        }
        continue
      }
      if (wasLastEmitBackpressured()) {
        scheduleMutationAdmissionRetry()
        return
      }
      // The rejected payload was never admitted. Discard it and every later
      // payload so no dependent parent/next id can overtake the gap. A generic
      // structural rejection keeps the conservative baseline recovery; only
      // transient encoder backpressure is retried in place.
      discardPendingMutationAdmissions()
      beginAdmissionGapRecovery('mutation_admission_rejected')
      return false
    }
    return true
  }

  function flushPendingMutations() {
    if (pendingMutationTimeout) {
      clearTimeout(pendingMutationTimeout)
      pendingMutationTimeout = undefined
    }
    if (!pendingMutationPayload) {
      drainPendingMutationAdmissions()
      return
    }
    var mutationPayloadToFlush = pendingMutationPayload
    var splitResult = splitPendingMutationPayloadForEmit(
      mutationPayloadToFlush,
      pendingPublicationTokenByNode,
      wasNodePublishedBeforePendingMutation
    )
    pendingMutationPayload = undefined
    var mutationEntries = splitResult.mutationEntries
    if (!mutationEntries.length) {
      discardMutationMembership(
        materializeMutationPayload(mutationPayloadToFlush)
      )
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      updateReplayPerformanceStats(
        mutationEntries.reduce(
          function (stats, mutationEntry) {
            var mutationPayload = mutationEntry[0]
            stats.mutationCallbackCount += 1
            stats.mutationRecordCount += countMutationPayloadRecords(
              mutationPayload
            )
            stats.mutationAddCount += mutationPayload.adds.length
            stats.mutationRemoveCount += mutationPayload.removes.length
            stats.mutationTextCount += mutationPayload.texts.length
            stats.mutationAttributeCount += mutationPayload.attributes.length
            return stats
          },
          {
            mutationCallbackCount: 0,
            mutationRecordCount: 0,
            mutationAddCount: 0,
            mutationRemoveCount: 0,
            mutationTextCount: 0,
            mutationAttributeCount: 0
          }
        )
      )
    }
    enqueueMutationEntriesForAdmission(mutationEntries)
    if (splitResult.hasOversizedEntry) {
      requestFullSnapshotAfterMutationDrop({
        reason: 'split_oversized_mutation_entry'
      })
    }
  }
  var inputCb = function (s) {
    emit(assembleIncrementalSnapshot(IncrementalSource.Input, s))
  }

  try {
    inputObserver = initInputObserver(
      inputCb,
      configuration,
      undefined,
      isNodeIgnoredForObserver
    )
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(inputObserver)

  var mutationResourceBudget = createMutationResourceBudget()
  var shadowRootsController
  try {
    shadowRootsController = initShadowRootsController(configuration, {
      mutationCb,
      mutationPerfCb: updateReplayPerformanceStats,
      mutationOverflowCb: requestFullSnapshotAfterMutationDrop,
      mutationActivityCb: trackDomMutationActivity,
      inputCb,
      isNodeIgnored: isObservedNodeIgnored,
      isInputNodeIgnored: isNodeIgnoredForObserver,
      isNodePublished: isNodeQueuedOrPublished,
      mutationNodeSerializationCb: stageMutationNodePublication,
      mutationResourceBudget: mutationResourceBudget,
      shadowRootCreatedCb: captureDynamicShadowRoot
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(shadowRootsController.stop)

  function isNodeIgnored(node, includeQueued) {
    try {
      return !isNodeInPublishedReplayTree(node, includeQueued)
    } catch (_) {
      // Publication membership is part of the replay baseline contract. If it
      // cannot be established, fail closed instead of emitting a stale id.
      return true
    }
  }

  function isObservedNodeIgnored(node, includeQueued) {
    var ignored = isNodeIgnored(node, includeQueued)
    if (
      ignored &&
      (pendingFullSnapshotTask || pendingFullSnapshotBaselineRecords) &&
      publishedNodeParentByNode.has(node)
    ) {
      // Input, media, scroll and CSSOM state are not DOM mutations. If an
      // observer ignores one after the node was serialized, rebuild the
      // mixed-time baseline so the state change is represented by the next
      // attempt. This
      // also covers an exact baseline waiting for encoder capacity: the
      // unpublished tree cannot accept an incremental state record there.
      pendingFullSnapshotRestartRequested = true
    }
    return ignored
  }

  function isNodeIgnoredForObserver(node, mutationAssembly) {
    if (mutationAssembly) {
      return isObservedNodeIgnored(node, true)
    }

    if (
      captureRecordsAgainstPreviousReplayTree &&
      !mutationSourceFlushInProgress
    ) {
      // Native DOM records queued earlier in the same task must be observed
      // before admitting this state record against the previous replay tail.
      // The activity callback promotes an optional baseline when necessary.
      capturePendingMutationActivityForPreviousReplayTree(false)
    }

    var ignored = isObservedNodeIgnored(node, true)
    var pendingPublicationToken =
      pendingPublicationTokenByNode.get(node)
    if (
      pendingPublicationToken &&
      !pendingPublicationToken.$rPublished &&
      !pendingPublicationToken.$rCanceled
    ) {
      if (!pendingPublicationToken.$rQueued) {
        // A time-sliced add serializer may already have walked this node while
        // its root is not publishable yet. Rebuild that root from current DOM
        // state so input/CSSOM changes between slices are not omitted.
        flushMutationRootForNode(node)
      } else if (pendingMutationPayload) {
        // The add is complete but still waiting in the 16 ms mutation emit
        // buffer. Move it into admission before the dependent state callback;
        // the state will then emit after a successful add or bind its barrier.
        flushPendingMutations()
      }
      ignored = isObservedNodeIgnored(node, true)
    }
    if (
      ignored &&
      captureRecordsAgainstPreviousReplayTree &&
      isNodeInPreviousPublishedReplayTree(node)
    ) {
      // The candidate tree is unpublished, but this node still belongs to the
      // previous replay tail. Let the shared admission path publish its state
      // before the replacement baseline (or queue it on encoder backpressure).
      return false
    }
    return ignored
  }

  function isNodeIgnoredForStatelessObserver(node) {
    if (
      captureRecordsAgainstPreviousReplayTree &&
      !mutationSourceFlushInProgress
    ) {
      capturePendingMutationActivityForPreviousReplayTree(false)
    }
    var ignored = isNodeIgnored(node)
    if (
      ignored &&
      captureRecordsAgainstPreviousReplayTree &&
      isNodeInPreviousPublishedReplayTree(node)
    ) {
      return false
    }
    return ignored
  }

  function getActiveSerializedNodeId(node) {
    if (isNodeIgnored(node)) {
      return undefined
    }
    return getSerializedNodeId(node)
  }

  function filterActiveSerializedCanvases(canvases) {
    return canvases.filter(function (canvas) {
      return !isNodeIgnored(canvas)
    })
  }

  function getActiveSerializedCanvases(maxScanCount) {
    return filterActiveSerializedCanvases(
      getSerializedCanvasNodes(maxScanCount)
    )
  }

  var lastAutoCanvasSnapshotResult
  var autoCanvasSnapshotDebugHistoryForDebug =
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__ ? [] : undefined
  var lastCanvasMutationForDebug
  var canvasMutationHistoryForDebug =
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__ ? [] : undefined
  var lastDomMutationForDebug
  var domMutationHistoryForDebug =
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__ ? [] : undefined
  function handleAutoCanvasSnapshotDebug(result) {
    var keepSessionAliveTriggered = false
    if (
      shouldKeepSessionAliveAfterAutoCanvasSnapshot(result) &&
      options.sessionManager &&
      options.sessionManager.keepSessionAlive
    ) {
      options.sessionManager.keepSessionAlive()
      keepSessionAliveTriggered = true
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      lastAutoCanvasSnapshotResult = cloneAutoCanvasSnapshotDebugResult(
        result,
        keepSessionAliveTriggered
      )
      pushCanvasDebugHistoryEntry(
        autoCanvasSnapshotDebugHistoryForDebug,
        lastAutoCanvasSnapshotResult
      )
    }
  }
  function handleCanvasMutationDebug(result) {
    lastCanvasMutationForDebug = cloneCanvasMutationDebugResult(result)
    pushCanvasDebugHistoryEntry(
      canvasMutationHistoryForDebug,
      lastCanvasMutationForDebug
    )
  }
  var shouldUseCanvasCommandCapture = shouldUseCommandCapture(
    configuration
  )
  var baseCanvasEncodeBridge
  var webGLReplayRuntime
  var canvasEncodeBridge
  try {
    var createCanvasEncodeBridgeImpl =
      __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? options.createCanvasEncodeBridge || createCanvasEncodeBridge
        : createCanvasEncodeBridge
    var createSessionReplayWebGLRuntimeImpl =
      __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? options.createSessionReplayWebGLRuntime ||
          createSessionReplayWebGLRuntime
        : createSessionReplayWebGLRuntime
    baseCanvasEncodeBridge = createCanvasEncodeBridgeImpl(
      configuration
    )
    webGLReplayRuntime = createSessionReplayWebGLRuntimeImpl(
      configuration,
      baseCanvasEncodeBridge,
      reportWebGLReplayFailure
    )
    canvasEncodeBridge = webGLReplayRuntime[0] || baseCanvasEncodeBridge
  } catch (error) {
    if (baseCanvasEncodeBridge && baseCanvasEncodeBridge.stop) {
      baseCanvasEncodeBridge.stop()
    }
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(canvasEncodeBridge.stop)

  var canvasObserver
  try {
    var createCanvasObserverImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? options.createCanvasObserver || createCanvasObserver
      : createCanvasObserver
    canvasObserver = createCanvasObserverImpl({
      configuration: configuration,
      emit: emit,
      encodeBridge: canvasEncodeBridge,
      isNodeActive: function (node) {
        return !isNodeIgnored(node)
      },
      flushMutations: function (canvas) {
        return flushMutationRootForNode(canvas)
      },
      onMutationDebug: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? handleCanvasMutationDebug
        : undefined
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(canvasObserver.stop)
  var startCanvasSnapshotLoop = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.startContinuousCanvasSnapshotLoop ||
      startContinuousCanvasSnapshotLoop
    : startContinuousCanvasSnapshotLoop
  var canvasSnapshotLoop
  try {
    canvasSnapshotLoop = startCanvasSnapshotLoop({
      configuration: configuration,
      getCanvases: function (maxScanCount) {
        return getActiveSerializedCanvases(maxScanCount).filter(
          function (canvas) {
            return (
              !isDrawDrivenWebGLCanvas(canvas) &&
              (!shouldUseCanvasCommandCapture ||
                !(canvas instanceof HTMLCanvasElement))
            )
          }
        )
      },
      getSerializedNodeId: function (canvas) {
        return getActiveSerializedNodeId(canvas)
      },
      onDebug: handleAutoCanvasSnapshotDebug,
      snapshotCanvas: function (canvas) {
        return snapshotCanvasIfActive(canvas, {
          trigger: 'auto',
          scheduler: 'continuous_snapshot'
        })
      }
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(function () {
    stopCanvasSnapshots(canvasSnapshotLoop)
  })

  var canvasCommandCapture
  try {
    var startCanvasCommandCaptureImpl =
      __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? options.startCanvasCommandCapture || startCanvasCommandCapture
        : startCanvasCommandCapture
    canvasCommandCapture = startCanvasCommandCaptureImpl({
      configuration: configuration,
      emit: emit,
      snapshotCanvas: function (canvas, snapshotOptions) {
        return snapshotCanvasIfActive(canvas, snapshotOptions)
      },
      getCanvases: function (maxScanCount) {
        return getActiveSerializedCanvases(maxScanCount)
      },
      getSerializedNodeId: function (canvas) {
        return getActiveSerializedNodeId(canvas)
      },
      onDebug: handleAutoCanvasSnapshotDebug,
      onMutationDebug: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? handleCanvasMutationDebug
        : undefined,
      flushMutations: function (canvas) {
        return flushMutationRootForNode(canvas)
      },
      startPaused: true
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  var canvasWebGLSnapshotObserver = createNoopObserver()
  try {
    var startCanvasWebGLSnapshotObserver =
      (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
        options.startCanvasWebGLSnapshotObserver) ||
      webGLReplayRuntime[1]
    if (startCanvasWebGLSnapshotObserver) {
      canvasWebGLSnapshotObserver =
        startCanvasWebGLSnapshotObserver(
          function (canvas, snapshotOptions) {
            return snapshotCanvasIfActive(canvas, snapshotOptions)
          },
          function (canvas) {
            return getActiveSerializedNodeId(canvas)
          },
          handleAutoCanvasSnapshotDebug
        ) || createNoopObserver()
    }
  } catch (error) {
    addTelemetryDebug('Session Replay WebGL observer failed.', {
      error: String(error)
    })
    canvasWebGLSnapshotObserver = createNoopObserver()
  }
  registerInitializationCleanup(canvasWebGLSnapshotObserver.stop)
  // The optional WebGL plugin installs its bootstrap getContext wrapper from
  // plugin.onInit(), before command capture wraps the same prototype.  Always
  // unwind command capture first so the WebGL observer can still recognize
  // and restore its own wrapper.  Keep initialization rollback in the same
  // order (cleanup tasks run in reverse registration order).
  registerInitializationCleanup(canvasCommandCapture.stop)

  function isDrawDrivenWebGLCanvas(canvas) {
    if (isWebGLReplayCanvas(canvas)) {
      return true
    }
    try {
      return !!canvasWebGLSnapshotObserver.isWebGLCanvas(canvas)
    } catch (_) {
      // A failing optional plugin must not block the ordinary 2D baseline.
      return false
    }
  }

  function snapshotCanvasIfActive(canvas, snapshotOptions) {
    if (isNodeIgnored(canvas)) {
      return Promise.resolve({
        ok: false,
        reason: 'not_serialized'
      })
    }
    var isCommandBaselineSnapshot =
      snapshotOptions &&
      (snapshotOptions.scheduler === 'full_snapshot_baseline' ||
        (snapshotOptions.scheduler === 'command_capture' &&
          snapshotOptions.force === true))
    var snapshotConsistencyToken =
      shouldUseCanvasCommandCapture &&
      canvasCommandCapture &&
      canvasCommandCapture.createCanvasSnapshotBaselineToken
        ? canvasCommandCapture.createCanvasSnapshotBaselineToken(canvas)
        : undefined
    var baselineToken = isCommandBaselineSnapshot
      ? snapshotConsistencyToken
      : undefined
    var effectiveSnapshotOptions = snapshotOptions
    if (
      snapshotConsistencyToken &&
      canvasCommandCapture &&
      canvasCommandCapture.$rIsSnapshotBaselineCurrent
    ) {
      var originalIsCancelled =
        effectiveSnapshotOptions &&
        effectiveSnapshotOptions.$rIsCancelled
      effectiveSnapshotOptions = assign({}, effectiveSnapshotOptions, {
        $rIsCancelled: function () {
          if (typeof originalIsCancelled === 'function') {
            try {
              if (originalIsCancelled()) {
                return true
              }
            } catch (_) {
              return true
            }
          }
          try {
            return !canvasCommandCapture.$rIsSnapshotBaselineCurrent(
              canvas,
              snapshotConsistencyToken
            )
          } catch (_) {
            return true
          }
        }
      })
    }
    return Promise.resolve(
      canvasObserver.snapshot(canvas, effectiveSnapshotOptions)
    ).then(function (result) {
      if (
        result &&
        result.ok === true &&
        baselineToken &&
        canvasCommandCapture &&
        canvasCommandCapture.markCanvasSnapshotBaseline
      ) {
        canvasCommandCapture.markCanvasSnapshotBaseline(
          canvas,
          baselineToken,
          effectiveSnapshotOptions.reason ||
            effectiveSnapshotOptions.scheduler
        )
      }
      return result
    })
  }

  function createFullSnapshotSerializerTask(serializationContext) {
    var publicationToken = currentFullSnapshotPublicationToken
    var createSerializerTask =
      (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
        options.$rCreateFullSnapshotSerializerTask) ||
      createMutationSerializerTask
    return createSerializerTask(document, {
      serializationContext: serializationContext,
      parentNodePrivacyLevel: configuration.defaultPrivacyLevel,
      configuration: configuration,
      onSerializedNode: function (node, parentNode) {
        stageFullSnapshotNodePublication(
          node,
          parentNode,
          publicationToken
        )
      }
    })
  }

  function advanceFullSnapshotSerializerTask(
    serializerTask,
    deadline
  ) {
    var maxNodeCount = Math.min(
      serializerTask.processedNodeCount + SERIALIZATION_MAX_NODE_COUNT,
      FULL_SNAPSHOT_SERIALIZATION_MAX_NODE_COUNT
    )
    var maxApproxBytes = Math.min(
      serializerTask.approxBytes + SERIALIZATION_MAX_APPROX_BYTES,
      FULL_SNAPSHOT_SERIALIZATION_MAX_APPROX_BYTES
    )
    var completed = serializerTask.advance(
      deadline,
      maxNodeCount,
      maxApproxBytes
    )
    return {
      completed: completed,
      isWatermarkReached:
        !completed &&
        (serializerTask.isMaxDepthReached ||
          serializerTask.isMaxNodeComplexityReached ||
          (serializerTask.isMaxNodeCountReached &&
            maxNodeCount >= FULL_SNAPSHOT_SERIALIZATION_MAX_NODE_COUNT) ||
          (serializerTask.isMaxApproxBytesReached &&
            maxApproxBytes >=
              FULL_SNAPSHOT_SERIALIZATION_MAX_APPROX_BYTES))
    }
  }

  function createFullSnapshotBaselineRecords(timestamp, serializedDocument) {
    var _viewportDimension = getViewportDimension()
    var width = _viewportDimension.width
    var height = _viewportDimension.height
    return [
      {
        data: {
          height: height,
          href: window.location.href,
          width: width
        },
        type: RecordType.Meta,
        timestamp: timestamp
      },
      {
        data: {
          has_focus: document.hasFocus()
        },
        type: RecordType.Focus,
        timestamp: timestamp
      },
      {
        data: {
          node: serializedDocument,
          initialOffset: {
            left: getScrollX(),
            top: getScrollY()
          }
        },
        type: RecordType.FullSnapshot,
        timestamp: timestamp
      }
    ]
  }

  function emitFullSnapshot(baselineRecords, startedAt) {
    // Baseline admission bypasses emit(). Do not inherit a local DOM-barrier
    // result from an earlier record: only the segment/encoder result for this
    // exact baseline may classify its rejection as transient backpressure.
    lastEmitWasLocallyBackpressured = false
    var timestamp = baselineRecords[0].timestamp
    var fullSnapshotAccepted
    if (rawEmitBaseline) {
      fullSnapshotAccepted = rawEmitBaseline(baselineRecords) !== false
    } else {
      fullSnapshotAccepted =
        rawEmit(baselineRecords[0]) !== false &&
        rawEmit(baselineRecords[1]) !== false &&
        rawEmit(baselineRecords[2]) !== false
    }
    if (!fullSnapshotAccepted) {
      return false
    }
    fullSnapshotWasPublished = true
    currentFullSnapshotPublicationToken.$rPublished = true

    if (window.visualViewport) {
      rawEmit({
        data: getVisualViewport(),
        type: RecordType.VisualViewport,
        timestamp: timestamp
      })
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      updateReplayPerformanceStats({
        fullSnapshotCount: 1,
        fullSnapshotDuration: getPerformanceTime() - startedAt
      })
    }
    return true
  }

  function invalidateFullSnapshotCanvasBaseline() {
    fullSnapshotCanvasBaselineGeneration += 1
  }

  function scanExistingCommandCaptureCanvases() {
    try {
      if (canvasCommandCapture.scanExistingCanvases) {
        canvasCommandCapture.scanExistingCanvases()
      }
    } catch (error) {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        addTelemetryDebug('Session Replay canvas baseline scan failed.', {
          error: String(error)
        })
      }
    }
  }

  function takeFullSnapshotCanvasBaseline() {
    if (
      !configuration.replayCanvasEnabled ||
      configuration.replayCanvasMode !== 'auto'
    ) {
      scanExistingCommandCaptureCanvases()
      return
    }

    var baselineGeneration = fullSnapshotCanvasBaselineGeneration + 1
    fullSnapshotCanvasBaselineGeneration = baselineGeneration
    var baselineStartedAt = getPerformanceTime()
    // The registry is already bounded and contains only canvases assigned an id
    // by the successful full snapshot. Do not inspect or create a target
    // context here. Static 2D/unknown canvases get a bitmap baseline, while a
    // known WebGL canvas must wait for its next real draw: staging it from this
    // asynchronous baseline task is unsafe with preserveDrawingBuffer=false.
    var canvases
    try {
      canvases = filterActiveSerializedCanvases(
        getSerializedCanvasNodesSnapshot(
          MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT
        )
      ).filter(function (canvas) {
        return !isDrawDrivenWebGLCanvas(canvas)
      })
    } catch (error) {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        addTelemetryDebug('Session Replay canvas baseline lookup failed.', {
          error: String(error)
        })
      }
      scanExistingCommandCaptureCanvases()
      return
    }
    var canvasIndex = 0

    function runNextCanvasBaseline() {
      if (
        recordStopping ||
        recordStopped ||
        baselineGeneration !== fullSnapshotCanvasBaselineGeneration
      ) {
        return Promise.resolve()
      }
      if (canvasIndex >= canvases.length) {
        scanExistingCommandCaptureCanvases()
        return Promise.resolve()
      }

      var canvas = canvases[canvasIndex]
      canvasIndex += 1
      var remainingBaselineTime =
        FULL_SNAPSHOT_CANVAS_BASELINE_TOTAL_TIMEOUT_MS -
        (getPerformanceTime() - baselineStartedAt)
      if (remainingBaselineTime <= 0) {
        if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
          addTelemetryDebug('Session Replay canvas baseline budget exhausted.', {
            canvasCount: canvases.length,
            completedCanvasCount: canvasIndex - 1
          })
        }
        scanExistingCommandCaptureCanvases()
        return Promise.resolve()
      }
      var canvasBaselineCancelled = false
      var snapshotResult
      try {
        snapshotResult = snapshotCanvasIfActive(canvas, {
          trigger: 'auto',
          scheduler: 'full_snapshot_baseline',
          $rIsCancelled: function () {
            return (
              canvasBaselineCancelled ||
              recordStopping ||
              recordStopped ||
              baselineGeneration !== fullSnapshotCanvasBaselineGeneration
            )
          }
        })
      } catch (_) {
        snapshotResult = undefined
      }
      var canvasBaselineTimeoutId
      var canvasBaselineTimeout = new Promise(function (resolve) {
        canvasBaselineTimeoutId = setTimeout(function () {
          canvasBaselineTimeoutId = undefined
          canvasBaselineCancelled = true
          if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
            addTelemetryDebug('Session Replay canvas baseline timed out.', {
              canvasIndex: canvasIndex,
              canvasCount: canvases.length
            })
          }
          resolve()
        }, Math.min(
          FULL_SNAPSHOT_CANVAS_BASELINE_ITEM_TIMEOUT_MS,
          remainingBaselineTime
        ))
      })
      return Promise.race([
        Promise.resolve(snapshotResult).catch(function () {}),
        canvasBaselineTimeout
      ]).then(function () {
        if (canvasBaselineTimeoutId !== undefined) {
          clearTimeout(canvasBaselineTimeoutId)
        }
        return runNextCanvasBaseline()
      })
    }

    // Invoke the first item synchronously so the baseline gets the first
    // encode slot after the full snapshot.  Remaining canvases are strictly
    // serial and failures never turn a valid DOM full snapshot into a failure.
    runNextCanvasBaseline()
  }

  var takeInitialFullSnapshot = function (timestamp, serializationContext) {
    var fullSnapshotStartedAt = getPerformanceTime()
    if (typeof timestamp === 'undefined') {
      timestamp = timeStampNow()
    }
    if (typeof serializationContext === 'undefined') {
      serializationContext = {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: elementsScrollPositions,
        shadowRootsController: shadowRootsController
      }
    }
    var serializerTask = createFullSnapshotSerializerTask(
      serializationContext
    )
    if (!serializerTask) {
      return {
        status: 'failed',
        reason: 'initial_full_snapshot_serialization_error'
      }
    }
    var advanceResult = advanceFullSnapshotSerializerTask(
      serializerTask,
      getPerformanceTime() + INITIAL_FULL_SNAPSHOT_SERIALIZATION_SLICE_MS
    )
    if (advanceResult.isWatermarkReached) {
      return {
        status: 'failed',
        reason: 'initial_full_snapshot_serialization_watermark'
      }
    }
    if (!advanceResult.completed) {
      return {
        status: 'pending',
        timestamp: timestamp
      }
    }
    var baselineRecords = createFullSnapshotBaselineRecords(
      timestamp,
      serializerTask.serializedNode
    )
    if (emitFullSnapshot(baselineRecords, fullSnapshotStartedAt)) {
      return { status: 'completed' }
    }
    if (wasLastEmitBackpressured()) {
      pendingFullSnapshotTimestamp = timestamp
      pendingFullSnapshotStartedAt = fullSnapshotStartedAt
      pendingFullSnapshotIsInitial = true
      pendingFullSnapshotBaselineRecords = baselineRecords
      pendingFullSnapshotBaselineMutationVersion = domMutationVersion
      suppressRecordsUntilFullSnapshot = true
      return { status: 'admission_pending', timestamp: timestamp }
    }
    return {
      status: 'failed',
      reason: 'initial_full_snapshot_admission_rejected'
    }
  }

  var initialFullSnapshotResult
  try {
    initialFullSnapshotResult = takeInitialFullSnapshot()
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  if (initialFullSnapshotResult.status === 'completed') {
    takeFullSnapshotCanvasBaseline()
  } else if (initialFullSnapshotResult.status === 'failed') {
    return abortRecorderInitialization(
      initialFullSnapshotResult.reason
    )
  } else if (initialFullSnapshotResult.status === 'pending') {
    // The first short attempt ran before MutationObservers existed. Restart
    // from a clean tree after observers are attached, so changes made between
    // slices cannot produce a mixed-time initial baseline.
    resetPublishedReplayTree()
  }
  var _initObservers
  try {
    var initObserversImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? options.initObservers || initObservers
      : initObservers
    _initObservers = initObserversImpl({
      lifeCycle: options.lifeCycle,
      configuration: configuration,
      elementsScrollPositions: elementsScrollPositions,
      inputCb: inputCb,
      mediaInteractionCb: function (p) {
        emit(
          assembleIncrementalSnapshot(IncrementalSource.MediaInteraction, p)
        )
      },
      mouseInteractionCb: function (mouseInteractionRecord) {
        emit(mouseInteractionRecord)
      },
      mousemoveCb: function (positions, source) {
        emit(assembleIncrementalSnapshot(source, { positions: positions }))
      },
      mutationCb: mutationCb,
      mutationPerfCb: updateReplayPerformanceStats,
      mutationOverflowCb: requestFullSnapshotAfterMutationDrop,
      mutationActivityCb: trackDomMutationActivity,
      mutationNodeSerializationCb: stageMutationNodePublication,
      mutationResourceBudget: mutationResourceBudget,
      inputObserver: inputObserver,
      isNodeIgnored: isNodeIgnoredForObserver,
      isNodeIgnoredForStatelessObserver:
        isNodeIgnoredForStatelessObserver,
      isNodePublished: isNodeQueuedOrPublished,
      scrollCb: function (p) {
        emit(assembleIncrementalSnapshot(IncrementalSource.Scroll, p))
      },
      styleSheetCb: function (r) {
        // The shared state-record admission path distinguishes transient
        // backpressure from a permanent CSSOM gap and starts exactly one
        // replacement baseline for the latter.
        emit(
          assembleIncrementalSnapshot(
            IncrementalSource.StyleSheetRule,
            r
          )
        )
      },
      viewportResizeCb: function (d) {
        emit(
          assembleIncrementalSnapshot(IncrementalSource.ViewportResize, d)
        )
      },
      frustrationCb: function (frustrationRecord) {
        emit(frustrationRecord)
      },
      focusCb: function (data) {
        emit({
          data: data,
          type: RecordType.Focus,
          timestamp: timeStampNow()
        })
      },
      visualViewportResizeCb: function (data) {
        emit({
          data: data,
          type: RecordType.VisualViewport,
          timestamp: timeStampNow()
        })
      },
      shadowRootsController: shadowRootsController
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(_initObservers.stop)
  refreshAndFlushPendingRootForNode =
    _initObservers.refreshAndFlushPendingRootForNode ||
    function () {}
  var stopObservers = _initObservers.stop
  var flushMutationsFromObservers = _initObservers.flush
  var resetMutationsFromObservers = _initObservers.reset || function () {}
  initializationCleanupTasks = []
  if (
    initialFullSnapshotResult.status === 'pending' &&
    !beginInitialFullSnapshot(initialFullSnapshotResult.timestamp)
  ) {
    return createInactiveRecorder()
  }
  if (initialFullSnapshotResult.status === 'admission_pending') {
    schedulePendingFullSnapshotSlice(MUTATION_ADMISSION_RETRY_DELAY_MS)
  }

  function requestFullSnapshotAfterMutationDrop(overflow) {
    if (recordStopping || recordStopped) {
      return
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      replayPerformanceStats.mutationDropRecoveryCount += 1
      replayPerformanceStats.mutationDropRecoveryLastReason =
        overflow && overflow.reason
          ? overflow.reason
          : 'unknown'
    }
    // Any dropped mutation makes the live DOM diverge from the last uploaded
    // baseline, even when the missing record only contains text or attributes.
    // The replacement snapshot must therefore complete. If it cannot fit the
    // bounded serializer/segment budgets, stop and discard the held tail
    // instead of restoring a tree that is known to be stale.
    flushPendingMutations()
    // Keep a safely admitted prefix, but retire the complete pre-transaction
    // deferred tail. Even an unbound Scroll/Canvas record can roll state back
    // if it is replayed after the replacement baseline. Only records produced
    // after the mandatory transaction starts may follow that baseline.
    discardPendingMutationPayload()
    discardPendingMutationAdmissions()
    clearDeferredRecords()
    scheduleMandatoryFullSnapshotAfterMutationDrop()
  }

  function beginAdmissionGapRecovery(reason) {
    if (recordStopping || recordStopped) {
      return
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      replayPerformanceStats.admissionGapRecoveryCount += 1
      replayPerformanceStats.admissionGapRecoveryLastReason =
        reason || 'unknown'
    }
    // A deferred CSSOM/Canvas state rejection can leave later DOM admissions
    // queued. Never pre-flush after that gap: the replacement baseline must
    // supersede the complete local admission window before any tail escapes.
    discardPendingMutationPayload()
    discardPendingMutationAdmissions()
    clearDeferredRecords()
    scheduleMandatoryFullSnapshotAfterMutationDrop()
  }

  function scheduleMandatoryFullSnapshotAfterMutationDrop() {
    scheduleSubsequentFullSnapshot(
      timeStampNow(),
      false,
      true
    )
  }
  function flushMutations(forceBoundaryDrain) {
    var boundaryDeadline = forceBoundaryDrain
      ? getPerformanceTime() +
        MUTATION_SOURCE_BOUNDARY_FLUSH_BUDGET_MS
      : undefined
    mutationSourceFlushInProgress = true
    try {
      var shadowFlushResult = true
      if (!mutationFlushDocumentPending) {
        do {
          shadowFlushResult = shadowRootsController.flush()
        } while (
          shadowFlushResult === 'pending' &&
          forceBoundaryDrain &&
          getPerformanceTime() < boundaryDeadline
        )
      }
      if (shadowFlushResult === 'pending') {
        scheduleMutationSourceFlushContinuation()
        return 'pending'
      }
      if (shadowFlushResult === false) {
        resetMutationsFromObservers()
        discardPendingMutationPayload()
        return false
      }
      mutationFlushDocumentPending = true
      var documentFlushResult
      do {
        documentFlushResult = flushMutationsFromObservers()
      } while (
        documentFlushResult === 'pending' &&
        forceBoundaryDrain &&
        getPerformanceTime() < boundaryDeadline
      )
      if (documentFlushResult === 'pending') {
        scheduleMutationSourceFlushContinuation()
        return 'pending'
      }
      if (documentFlushResult === false) {
        mutationFlushDocumentPending = false
        resetMutationsFromObservers()
        if (shadowRootsController.reset) {
          shadowRootsController.reset()
        }
        discardPendingMutationPayload()
        return false
      }
    } finally {
      mutationSourceFlushInProgress = false
    }
    mutationFlushDocumentPending = false
    flushPendingMutations()
    return true
  }

  function capturePendingMutationActivityForPreviousReplayTree(
    includeShadowRoots
  ) {
    if (
      !captureRecordsAgainstPreviousReplayTree ||
      mutationSourceFlushInProgress
    ) {
      return
    }
    var resetShadowMutationsForBaseline = includeShadowRoots
      ? shadowRootsController.$rResetPendingMutationsForBaseline
      : undefined
    if (resetShadowMutationsForBaseline) {
      var shadowResetResult = resetShadowMutationsForBaseline()
      if (shadowResetResult !== true) {
        // Do not synchronously walk an arbitrary number of roots from an input
        // handler. An incomplete reset means the optional candidate is no
        // longer safe to abandon; the rebuilt baseline will absorb the live
        // DOM.
        pendingFullSnapshotCanBeDiscarded = false
        pendingFullSnapshotRestartRequested = true
        pendingFullSnapshotTimestamp = Math.max(
          typeof pendingFullSnapshotTimestamp === 'number'
            ? pendingFullSnapshotTimestamp
            : 0,
          timeStampNow()
        )
      }
    }
    resetMutationsFromObservers()
    discardPendingMutationPayload()
  }

  function scheduleMutationSourceFlushContinuation() {
    if (
      mutationSourceFlushContinuationTimeout !== undefined ||
      recordStopping ||
      recordStopped
    ) {
      return
    }
    mutationSourceFlushContinuationTimeout = setTimeout(function () {
      mutationSourceFlushContinuationTimeout = undefined
      flushMutations()
    }, 0)
  }

  function cancelMutationSourceFlushContinuation() {
    if (mutationSourceFlushContinuationTimeout !== undefined) {
      clearTimeout(mutationSourceFlushContinuationTimeout)
      mutationSourceFlushContinuationTimeout = undefined
    }
    mutationFlushDocumentPending = false
  }

  function flushMutationRootForNode(node) {
    if (!node || !flushMutationsFromObservers) {
      return
    }
    mutationSourceFlushInProgress = true
    var flushResult
    try {
      flushResult = refreshAndFlushPendingRootForNode(node)
      if (
        typeof flushResult === 'undefined' &&
        shadowRootsController.refreshAndFlushPendingRootForNode
      ) {
        flushResult =
          shadowRootsController.refreshAndFlushPendingRootForNode(node)
      }
    } finally {
      mutationSourceFlushInProgress = false
    }
    if (flushResult === false) {
      return false
    }
    flushPendingMutations()
    return (
      !pendingMutationAdmissionQueue.length &&
      !suppressRecordsUntilFullSnapshot &&
      !recordStopped
    )
  }

  function discardPendingMutationPayload() {
    if (pendingMutationTimeout) {
      clearTimeout(pendingMutationTimeout)
      pendingMutationTimeout = undefined
    }
    if (pendingMutationPayload) {
      discardMutationMembership(
        materializeMutationPayload(pendingMutationPayload)
      )
    }
    pendingMutationPayload = undefined
  }

  function prepareMutationBaseline(preserveShadowRootObservers) {
    // A full snapshot supersedes mutation work that has not been emitted yet.
    // Do not force-drain time-sliced serializers immediately before traversing
    // the complete document.
    cancelMutationSourceFlushContinuation()
    flushPendingMutations()
    discardPendingMutationAdmissions()
    resetMutationsFromObservers()
    if (
      !preserveShadowRootObservers &&
      shadowRootsController.reset
    ) {
      shadowRootsController.reset()
    }
    mutationResourceBudget.reset()
    discardPendingMutationPayload()
    resetPublishedReplayTree()
  }

  function prepareForViewChange() {
    // View boundaries retire every event ordered against the old replay tree.
    // Internal baseline retries preserve records captured during serialization,
    // so keep this clearing behavior on the public view transition only.
    // Give a paged raw/shadow transaction one final bounded drain before the
    // old tree is retired. If it is still pending, prepareMutationBaseline()
    // drops the complete uncommitted transaction; VIEW_CREATED then publishes
    // the replacement baseline instead of exposing a half-applied move.
    var flushResult = flushMutations(true)
    if (flushResult === 'pending') {
      addTelemetryDebug(
        'Session Replay dropped a pending mutation transaction at a view boundary.',
        { reason: 'view_boundary_mutation_tail_pending' }
      )
    }
    clearDeferredRecords()
    prepareMutationBaseline()
    return flushResult
  }

  function resetCanvasRecordingBaseline() {
    invalidateFullSnapshotCanvasBaseline()
    if (canvasObserver.reset) {
      canvasObserver.reset()
    }
    if (canvasWebGLSnapshotObserver.reset) {
      canvasWebGLSnapshotObserver.reset()
    }
    if (canvasCommandCapture.reset) {
      canvasCommandCapture.reset()
    }
    resetCanvasSnapshots(canvasSnapshotLoop)
  }

  function prepareForFullSnapshot() {
    // While the previous replay tail remains valid, keep its ShadowRoot
    // observers alive until the candidate baseline commits or abandons. This
    // closes the same-task window where a shadow mutation could otherwise
    // happen after begin() but before the serializer re-registers the root.
    prepareMutationBaseline(
      captureRecordsAgainstPreviousReplayTree &&
        pendingFullSnapshotCanBeDiscarded
    )
    resetCanvasRecordingBaseline()
  }

  function clearPendingFullSnapshotTimeout() {
    if (pendingFullSnapshotTimeout !== undefined) {
      clearTimeout(pendingFullSnapshotTimeout)
      pendingFullSnapshotTimeout = undefined
    }
  }

  function cancelScheduledFullSnapshot() {
    clearPendingFullSnapshotTimeout()
    pendingFullSnapshotTimestamp = undefined
    pendingFullSnapshotCanBeDiscarded = false
    pendingFullSnapshotRequiresTailDiscard = false
    pendingFullSnapshotTask = undefined
    pendingFullSnapshotMutationVersion = undefined
    pendingFullSnapshotStartedAt = undefined
    pendingFullSnapshotActiveDuration = 0
    pendingFullSnapshotRestartCount = 0
    pendingFullSnapshotRestartRequested = false
    pendingFullSnapshotSynchronousFallbackAttempted = false
    pendingFullSnapshotIsInitial = false
    pendingFullSnapshotBaselineRecords = undefined
    pendingFullSnapshotBaselineMutationVersion = undefined
  }

  function clearDeferredRecords() {
    if (deferredRecordAdmissionTimeout !== undefined) {
      clearTimeout(deferredRecordAdmissionTimeout)
      deferredRecordAdmissionTimeout = undefined
    }
    deferredRecords = []
    deferredRecordsApproxBytes = 0
  }

  function isDeferredRecordAfterFullSnapshot(entry, timestamp) {
    return Boolean(
      entry &&
        entry.$rRecord &&
        typeof entry.$rRecord.timestamp === 'number' &&
        entry.$rRecord.timestamp > timestamp
    )
  }

  function flushAndRetireDeferredRecordsBeforeFullSnapshot(timestamp) {
    if (deferredRecordAdmissionTimeout !== undefined) {
      clearTimeout(deferredRecordAdmissionTimeout)
      deferredRecordAdmissionTimeout = undefined
    }
    if (!deferredRecords.length) {
      return false
    }
    var drainStartedAt = getPerformanceTime()
    var drainedApproxBytes = 0
    while (deferredRecords.length) {
      var entry = deferredRecords[0]
      if (isDeferredRecordAfterFullSnapshot(entry, timestamp)) {
        break
      }
      if (
        entry.$rMutationAdmissionBarrier &&
        entry.$rMutationAdmissionBarrier.$rPendingAdmission
      ) {
        break
      }
      if (rawEmit(entry.$rRecord) === false) {
        break
      }
      deferredRecords.shift()
      deferredRecordsApproxBytes -= entry.$rApproxBytes
      drainedApproxBytes += entry.$rApproxBytes
      if (
        drainedApproxBytes >=
          MUTATION_ADMISSION_DRAIN_SLICE_APPROX_BYTES ||
        getPerformanceTime() - drainStartedAt >=
          MUTATION_ADMISSION_DRAIN_SLICE_MS
      ) {
        break
      }
    }
    // A replacement baseline supersedes only records at or before its own
    // timestamp. Preserve a future-dated suffix captured inside the current
    // transaction so it can follow the replacement baseline. The bounded
    // prefix attempt avoids adding an unbounded encode loop to this boundary.
    var retainedDeferredRecords = []
    var retainedDeferredRecordsApproxBytes = 0
    var retiredStatefulRecord = false
    deferredRecords.forEach(function (entry) {
      if (isDeferredRecordAfterFullSnapshot(entry, timestamp)) {
        retainedDeferredRecords.push(entry)
        retainedDeferredRecordsApproxBytes += entry.$rApproxBytes
      } else if (isStatefulDeferredRecord(entry.$rRecord)) {
        retiredStatefulRecord = true
      }
    })
    deferredRecords = retainedDeferredRecords
    deferredRecordsApproxBytes = retainedDeferredRecordsApproxBytes
    return retiredStatefulRecord
  }

  function handleDeferredRecordLoss(record) {
    if (!isStatefulDeferredRecord(record)) {
      return
    }
    if (pendingFullSnapshotTask) {
      beginAdmissionGapRecovery('deferred_stateful_record_loss')
      return
    }
    beginAdmissionGapRecovery('deferred_stateful_record_loss')
  }

  function scheduleDeferredRecordAdmissionRetry() {
    scheduleDeferredRecordAdmissionDrain(
      MUTATION_ADMISSION_RETRY_DELAY_MS
    )
  }

  function scheduleDeferredRecordAdmissionContinuation() {
    scheduleDeferredRecordAdmissionDrain(0)
  }

  function scheduleDeferredRecordAdmissionDrain(delay) {
    if (
      deferredRecordAdmissionTimeout !== undefined ||
      !deferredRecords.length ||
      recordStopping ||
      recordStopped
    ) {
      return
    }
    deferredRecordAdmissionTimeout = setTimeout(function () {
      deferredRecordAdmissionTimeout = undefined
      var mutationAdmissionBarrier = deferredRecords.length
        ? deferredRecords[0].$rMutationAdmissionBarrier
        : undefined
      var barrierWasDrained = flushDeferredRecords(
        mutationAdmissionBarrier
      )
      if (barrierWasDrained) {
        scheduleMutationAdmissionContinuation()
      }
    }, delay)
  }

  function flushDeferredRecords(mutationAdmissionBarrier, drainState) {
    if (
      suppressRecordsUntilFullSnapshot ||
      recordStopped
    ) {
      return false
    }
    if (deferredRecordAdmissionTimeout !== undefined) {
      clearTimeout(deferredRecordAdmissionTimeout)
      deferredRecordAdmissionTimeout = undefined
    }
    drainState = drainState || {
      $rStartedAt: getPerformanceTime(),
      $rApproxBytes: 0
    }
    while (deferredRecords.length) {
      var entry = deferredRecords[0]
      if (
        entry.$rMutationAdmissionBarrier &&
        (entry.$rMutationAdmissionBarrier.$rPendingAdmission ||
          (mutationAdmissionBarrier &&
            entry.$rMutationAdmissionBarrier !==
              mutationAdmissionBarrier))
      ) {
        // A global/no-barrier drain may consume its unbound prefix, but a
        // state record for a still-pending DOM add must wait for mutation
        // admission. A concrete barrier drain likewise stops at the next
        // structural boundary.
        return true
      }
      if (rawEmit(entry.$rRecord) !== false) {
        deferredRecords.shift()
        deferredRecordsApproxBytes -= entry.$rApproxBytes
        drainState.$rApproxBytes += entry.$rApproxBytes
        if (
          deferredRecords.length &&
          (!mutationAdmissionBarrier ||
            !deferredRecords[0].$rMutationAdmissionBarrier ||
            deferredRecords[0].$rMutationAdmissionBarrier ===
              mutationAdmissionBarrier) &&
          (drainState.$rApproxBytes >=
            MUTATION_ADMISSION_DRAIN_SLICE_APPROX_BYTES ||
            getPerformanceTime() - drainState.$rStartedAt >=
              MUTATION_ADMISSION_DRAIN_SLICE_MS)
        ) {
          scheduleDeferredRecordAdmissionContinuation()
          return false
        }
        continue
      }
      if (
        options.$rWasLastEmitBackpressured &&
        options.$rWasLastEmitBackpressured()
      ) {
        scheduleDeferredRecordAdmissionRetry()
        return false
      }
      deferredRecords.shift()
      deferredRecordsApproxBytes -= entry.$rApproxBytes
      if (isStatefulDeferredRecord(entry.$rRecord)) {
        // Canvas commands and CSSOM rule indexes form ordered state chains.
        // A permanent gap cannot be skipped; supersede the remainder with a
        // fresh mandatory baseline instead.
        beginAdmissionGapRecovery('deferred_stateful_record_rejected')
        return false
      }
    }
    return true
  }

  function restoreRecordingAfterAbandonedFullSnapshot(
    beforeShadowRootRollback
  ) {
    restorePreviousPublishedReplayTree()
    suppressRecordsUntilFullSnapshot = false
    if (beforeShadowRootRollback) {
      beforeShadowRootRollback()
    }
    if (shadowRootsController.$rRollbackRecovery) {
      shadowRootsController.$rRollbackRecovery()
    }
    // Bitmap snapshots produced while the replacement baseline was being
    // serialized were deferred and are discarded on abandon. The shared
    // Canvas observer may already have advanced its frame signature/data URL
    // baseline, so reset every scheduler before rescanning; otherwise the
    // unchanged frame would never be emitted after recording resumes.
    resetCanvasRecordingBaseline()
    scanExistingCommandCaptureCanvases()
  }

  function beginInitialFullSnapshot(timestamp) {
    if (recordStopping || recordStopped) {
      return false
    }
    cancelScheduledFullSnapshot()
    pendingFullSnapshotTimestamp = timestamp
    pendingFullSnapshotStartedAt = getPerformanceTime()
    pendingFullSnapshotActiveDuration = 0
    pendingFullSnapshotRestartCount = 0
    pendingFullSnapshotRestartRequested = false
    pendingFullSnapshotIsInitial = true
    suppressRecordsUntilFullSnapshot = true
    try {
      prepareForFullSnapshot()
      createPendingFullSnapshotTask()
    } catch (error) {
      return handleFullSnapshotException(
        'full_snapshot_initialization_error',
        error
      )
    }
    schedulePendingFullSnapshotSlice()
    return true
  }

  function beginSubsequentFullSnapshot(
    timestamp,
    canBeDiscarded,
    requiresTailDiscard
  ) {
    if (recordStopping || recordStopped) {
      return false
    }
    var replacesPendingFullSnapshot =
      pendingFullSnapshotTimestamp !== undefined
    var previousTransactionTimestamp = pendingFullSnapshotTimestamp
    var fullSnapshotTimestamp =
      typeof timestamp === 'undefined' ? timeStampNow() : timestamp
    if (
      replacesPendingFullSnapshot &&
      typeof previousTransactionTimestamp === 'number'
    ) {
      fullSnapshotTimestamp = Math.max(
        fullSnapshotTimestamp,
        previousTransactionTimestamp
      )
    }
    if (typeof previousReplayTreeLastRecordTimestamp === 'number') {
      fullSnapshotTimestamp = Math.max(
        fullSnapshotTimestamp,
        previousReplayTreeLastRecordTimestamp
      )
    }
    var retiredStatefulRecord =
      flushAndRetireDeferredRecordsBeforeFullSnapshot(
        fullSnapshotTimestamp
      )
    cancelScheduledFullSnapshot()
    pendingFullSnapshotTimestamp = fullSnapshotTimestamp
    pendingFullSnapshotCanBeDiscarded =
      Boolean(canBeDiscarded) && !retiredStatefulRecord
    pendingFullSnapshotRequiresTailDiscard = Boolean(
      requiresTailDiscard
    )
    if (
      pendingFullSnapshotRequiresTailDiscard &&
      options.$rOnMandatoryFullSnapshotStarted
    ) {
      options.$rOnMandatoryFullSnapshotStarted()
    }
    pendingFullSnapshotStartedAt = getPerformanceTime()
    pendingFullSnapshotActiveDuration = 0
    pendingFullSnapshotRestartCount = 0
    pendingFullSnapshotRestartRequested = false
    pendingFullSnapshotIsInitial = !fullSnapshotWasPublished
    if (
      !replacesPendingFullSnapshot ||
      pendingFullSnapshotRequiresTailDiscard
    ) {
      resetPreviousReplayTreeRecords()
    }
    captureRecordsAgainstPreviousReplayTree =
      !pendingFullSnapshotIsInitial &&
      !pendingFullSnapshotRequiresTailDiscard
    previousReplayTreeAdmissionActive =
      captureRecordsAgainstPreviousReplayTree
    suppressRecordsUntilFullSnapshot = true
    if (!previousPublishedReplayTree) {
      previousPublishedReplayTree = getPublishedReplayTree()
    }
    try {
      if (
        !pendingFullSnapshotIsInitial &&
        shadowRootsController.$rBeginRecovery
      ) {
        shadowRootsController.$rBeginRecovery()
      }
      prepareForFullSnapshot()
      createPendingFullSnapshotTask()
    } catch (error) {
      return handleFullSnapshotException(
        'full_snapshot_initialization_error',
        error
      )
    }
    return true
  }

  function createPendingFullSnapshotTask() {
    if (pendingFullSnapshotIsInitial) {
      elementsScrollPositions.reset()
    }
    pendingFullSnapshotTask = createFullSnapshotSerializerTask({
      shadowRootsController: shadowRootsController,
      status: pendingFullSnapshotIsInitial
        ? SerializationContextStatus.INITIAL_FULL_SNAPSHOT
        : SerializationContextStatus.SUBSEQUENT_FULL_SNAPSHOT,
      elementsScrollPositions: elementsScrollPositions
    })
    if (!pendingFullSnapshotTask) {
      throw new Error('Full snapshot unavailable.')
    }
    pendingFullSnapshotMutationVersion = domMutationVersion
  }

  function schedulePendingFullSnapshotSlice(delay) {
    if (
      recordStopping ||
      recordStopped ||
      pendingFullSnapshotTimeout !== undefined ||
      pendingFullSnapshotTimestamp === undefined
    ) {
      return
    }
    delay = delay || 0
    pendingFullSnapshotTimeout = setTimeout(function () {
      pendingFullSnapshotTimeout = undefined
      if (failPendingFullSnapshotOnTimeout()) {
        return
      }
      if (pendingFullSnapshotBaselineRecords) {
        runPendingFullSnapshotSliceSafely(true)
        return
      }
      if (!pendingFullSnapshotTask) {
        var completeSynchronously = false
        if (
          pendingFullSnapshotMutationVersion !== domMutationVersion
        ) {
          pendingFullSnapshotMutationVersion = domMutationVersion
          if (
            pendingFullSnapshotSynchronousFallbackAttempted ||
            getPerformanceTime() - pendingFullSnapshotStartedAt <
              FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS
          ) {
            schedulePendingFullSnapshotSlice(delay)
            return
          }
          pendingFullSnapshotSynchronousFallbackAttempted = true
          completeSynchronously = true
        }
        try {
          prepareForFullSnapshot()
          clearDeferredRecords()
          createPendingFullSnapshotTask()
        } catch (error) {
          return handleFullSnapshotException(
            'full_snapshot_initialization_error',
            error
          )
        }
        if (completeSynchronously) {
          var synchronousStartedAt = getPerformanceTime()
          var synchronousDeadline =
            synchronousStartedAt +
            FULL_SNAPSHOT_SYNCHRONOUS_FINALIZATION_BUDGET_MS
          var synchronousMaxSliceCount = Math.ceil(
            FULL_SNAPSHOT_SYNCHRONOUS_FINALIZATION_BUDGET_MS /
              FULL_SNAPSHOT_SERIALIZATION_SLICE_MS
          )
          var synchronousSliceCount = 0
          while (pendingFullSnapshotTask) {
            if (
              synchronousSliceCount >= synchronousMaxSliceCount ||
              getPerformanceTime() >= synchronousDeadline
            ) {
              deferPendingFullSnapshotUntilQuiet()
              return
            }
            synchronousSliceCount += 1
            if (
              runPendingFullSnapshotSliceSafely(
                false,
                synchronousDeadline
              )
            ) {
              return
            }
            if (pendingFullSnapshotBaselineRecords) {
              schedulePendingFullSnapshotSlice(
                MUTATION_ADMISSION_RETRY_DELAY_MS
              )
              return
            }
          }
          return
        }
      }
      runPendingFullSnapshotSliceSafely(true)
    }, delay)
  }

  function deferPendingFullSnapshotUntilQuiet() {
    pendingFullSnapshotTask = undefined
    pendingFullSnapshotRestartRequested = false
    try {
      prepareForFullSnapshot()
      clearDeferredRecords()
      pendingFullSnapshotMutationVersion = domMutationVersion
    } catch (error) {
      return handleFullSnapshotException(
        'full_snapshot_initialization_error',
        error
      )
    }
    schedulePendingFullSnapshotSlice(
      FULL_SNAPSHOT_MUTATION_QUIET_DELAY_MS
    )
  }

  function restartPendingFullSnapshot(allowScheduling) {
    pendingFullSnapshotRestartCount += 1
    pendingFullSnapshotRestartRequested = false
    if (failPendingFullSnapshotOnTimeout()) {
      return
    }
    if (
      pendingFullSnapshotRestartCount > FULL_SNAPSHOT_MAX_RESTART_COUNT
    ) {
      if (
        !pendingFullSnapshotCanBeDiscarded &&
        allowScheduling
      ) {
        // Keep one bounded transaction alive while a large dashboard mutates.
        // A single timer waits for a quiet window; no serializer task or
        // deferred tail grows while churn continues.
        deferPendingFullSnapshotUntilQuiet()
        return
      }
      failOrAbandonFullSnapshot(
        'full_snapshot_changed_during_serialization'
      )
      return
    }
    // Records produced while serializing a discarded attempt may reference
    // nodes (including canvases) that are not part of the replacement
    // baseline. Never carry them across the generation boundary.
    try {
      clearDeferredRecords()
      prepareMutationBaseline()
      resetCanvasRecordingBaseline()
      createPendingFullSnapshotTask()
    } catch (error) {
      return handleFullSnapshotException(
        'full_snapshot_initialization_error',
        error
      )
    }
    if (allowScheduling) {
      schedulePendingFullSnapshotSlice()
    }
  }

  function runPendingFullSnapshotSlice(
    allowScheduling,
    serializationDeadline
  ) {
    if (pendingFullSnapshotBaselineRecords) {
      return tryPendingFullSnapshotAdmission(allowScheduling)
    }
    if (!pendingFullSnapshotTask || recordStopped) {
      return false
    }
    if (failPendingFullSnapshotOnTimeout()) {
      return false
    }
    if (
      pendingFullSnapshotRestartRequested ||
      pendingFullSnapshotMutationVersion !== domMutationVersion
    ) {
      restartPendingFullSnapshot(allowScheduling)
      return false
    }

    var sliceStartedAt = getPerformanceTime()
    var sliceDeadline =
      sliceStartedAt + FULL_SNAPSHOT_SERIALIZATION_SLICE_MS
    if (
      typeof serializationDeadline === 'number' &&
      isFinite(serializationDeadline)
    ) {
      sliceDeadline = Math.min(sliceDeadline, serializationDeadline)
    }
    var advanceResult = advanceFullSnapshotSerializerTask(
      pendingFullSnapshotTask,
      sliceDeadline
    )
    pendingFullSnapshotActiveDuration += Math.max(
      getPerformanceTime() - sliceStartedAt,
      0
    )
    if (failPendingFullSnapshotOnTimeout()) {
      return false
    }
    if (advanceResult.isWatermarkReached) {
      failOrAbandonFullSnapshot('full_snapshot_serialization_watermark')
      return false
    }
    if (!advanceResult.completed) {
      if (allowScheduling) {
        schedulePendingFullSnapshotSlice()
      }
      return false
    }

    // Capture native records that have not reached their observer callback yet.
    // Shadow observers are reset in bounded pages: reset() performs
    // takeRecords() and reports activity without serializing a mutation tail
    // that this replacement baseline will supersede.
    var resetShadowMutationsForBaseline =
      shadowRootsController.$rResetPendingMutationsForBaseline
    if (resetShadowMutationsForBaseline) {
      var shadowResetResult = resetShadowMutationsForBaseline()
      if (shadowResetResult === 'pending') {
        if (allowScheduling) {
          schedulePendingFullSnapshotSlice()
        }
        return false
      }
      if (shadowResetResult === false) {
        restartPendingFullSnapshot(allowScheduling)
        return false
      }
    }
    resetMutationsFromObservers()
    // Shadow-root observers created while the snapshot was serialized already
    // belong to the new generation. Mutations between slices have delivered an
    // activity callback and will restart the snapshot; retiring this generation
    // here would leave the emitted baseline without active shadow observers.
    discardPendingMutationPayload()
    if (pendingFullSnapshotMutationVersion !== domMutationVersion) {
      restartPendingFullSnapshot(allowScheduling)
      return false
    }

    var serializedDocument = pendingFullSnapshotTask.serializedNode
    pendingFullSnapshotBaselineRecords = createFullSnapshotBaselineRecords(
      pendingFullSnapshotTimestamp,
      serializedDocument
    )
    pendingFullSnapshotBaselineMutationVersion =
      pendingFullSnapshotMutationVersion
    return tryPendingFullSnapshotAdmission(allowScheduling)
  }

  function tryPendingFullSnapshotAdmission(allowScheduling) {
    if (
      !pendingFullSnapshotBaselineRecords ||
      recordStopped
    ) {
      return false
    }
    if (failPendingFullSnapshotOnTimeout()) {
      return false
    }
    if (!drainPreviousReplayTreeRecords()) {
      if (allowScheduling) {
        schedulePendingFullSnapshotSlice(
          MUTATION_ADMISSION_RETRY_DELAY_MS
        )
      }
      return false
    }
    if (failPendingFullSnapshotOnTimeout()) {
      return false
    }
    if (
      pendingFullSnapshotRestartRequested ||
      pendingFullSnapshotBaselineMutationVersion !== domMutationVersion
    ) {
      pendingFullSnapshotBaselineRecords = undefined
      pendingFullSnapshotBaselineMutationVersion = undefined
      discardPendingMutationPayload()
      discardPendingMutationAdmissions()
      prepareForFullSnapshot()
      createPendingFullSnapshotTask()
      pendingFullSnapshotRestartRequested = false
      if (allowScheduling) {
        schedulePendingFullSnapshotSlice()
      }
      return false
    }
    if (
      pendingFullSnapshotBaselineRecords[0].timestamp !==
      pendingFullSnapshotTimestamp
    ) {
      pendingFullSnapshotBaselineRecords =
        createFullSnapshotBaselineRecords(
          pendingFullSnapshotTimestamp,
          pendingFullSnapshotBaselineRecords[2].data.node
        )
    }
    var baselineRecords = pendingFullSnapshotBaselineRecords
    var startedAt = pendingFullSnapshotStartedAt
    var wasInitialFullSnapshot = pendingFullSnapshotIsInitial
    // Release the completed serializer and its timer while preserving the
    // exact baseline transaction for a possible backpressure retry.
    pendingFullSnapshotTask = undefined
    clearPendingFullSnapshotTimeout()
    if (!emitFullSnapshot(baselineRecords, startedAt)) {
      if (wasLastEmitBackpressured()) {
        if (allowScheduling) {
          schedulePendingFullSnapshotSlice(
            MUTATION_ADMISSION_RETRY_DELAY_MS
          )
        }
        return false
      }
      pendingFullSnapshotBaselineRecords = undefined
      pendingFullSnapshotBaselineMutationVersion = undefined
      failOrAbandonFullSnapshot('full_snapshot_admission_rejected')
      return false
    }
    pendingFullSnapshotBaselineRecords = undefined
    pendingFullSnapshotBaselineMutationVersion = undefined
    cancelScheduledFullSnapshot()
    if (
      !wasInitialFullSnapshot &&
      shadowRootsController.$rCommitRecovery
    ) {
      shadowRootsController.$rCommitRecovery()
    }
    previousPublishedReplayTree = undefined
    suppressRecordsUntilFullSnapshot = false
    drainPendingMutationAdmissions()
    resetPreviousReplayTreeRecords()
    previousReplayTreeAdmissionActive = false
    captureRecordsAgainstPreviousReplayTree = false
    flushDeferredRecords()
    if (!suppressRecordsUntilFullSnapshot && !recordStopped) {
      takeFullSnapshotCanvasBaseline()
    }
    return true
  }

  function handleFullSnapshotException(reason, error) {
    addTelemetryDebug('Session Replay full snapshot failed.', {
      reason: reason,
      error: String(error)
    })
    failOrAbandonFullSnapshot(reason)
    return false
  }

  function failPendingFullSnapshotOnTimeout() {
    if (
      pendingFullSnapshotTimestamp === undefined ||
      (pendingFullSnapshotActiveDuration <=
        FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS &&
        getPerformanceTime() - pendingFullSnapshotStartedAt <=
          FULL_SNAPSHOT_MAX_WALL_DURATION_MS)
    ) {
      return false
    }
    failOrAbandonFullSnapshot('full_snapshot_serialization_timeout')
    return true
  }

  function runPendingFullSnapshotSliceSafely(
    allowScheduling,
    serializationDeadline
  ) {
    try {
      return runPendingFullSnapshotSlice(
        allowScheduling,
        serializationDeadline
      )
    } catch (error) {
      return handleFullSnapshotException(
        'full_snapshot_serialization_error',
        error
      )
    }
  }

  function abandonPendingFullSnapshot(skipRecoveryRestore) {
    var shouldDiscardTail =
      pendingFullSnapshotRequiresTailDiscard
    var restoreError
    cancelScheduledFullSnapshot()
    clearDeferredRecords()
    try {
      if (skipRecoveryRestore) {
        // Teardown immediately retires every observer and Canvas scheduler.
        // Rebuilding up to 64 ShadowRoot observers and rescanning canvases here
        // would add pure main-thread work to stop() only to destroy it again.
        previousPublishedReplayTree = undefined
        suppressRecordsUntilFullSnapshot = false
      } else {
        restoreRecordingAfterAbandonedFullSnapshot(function () {
          restorePreviousReplayTreeRecords()
          // The native observer callback may not have run yet in this JavaScript
          // turn. Now that the old publication tree is active again, serialize
          // the bounded main/shadow mutation tail before retiring recovery
          // observers, instead of silently dropping it.
          flushMutations(true)
        })
      }
    } catch (error) {
      restoreError = error
    } finally {
      if (skipRecoveryRestore) {
        resetPreviousReplayTreeRecords()
      } else {
        previousReplayTreeLastRecordTimestamp = undefined
      }
      previousReplayTreeAdmissionActive = false
      captureRecordsAgainstPreviousReplayTree = false
      if (
        shouldDiscardTail &&
        options.$rOnMandatoryFullSnapshotAbandoned
      ) {
        options.$rOnMandatoryFullSnapshotAbandoned()
      }
    }
    if (restoreError) {
      return handleFullSnapshotException(
        'full_snapshot_abandon_restore_error',
        restoreError
      )
    }
    return true
  }

  function failOrAbandonFullSnapshot(reason) {
    if (pendingFullSnapshotCanBeDiscarded) {
      return abandonPendingFullSnapshot()
    }
    return failFullSnapshot(reason)
  }

  function failFullSnapshot(reason) {
    var failureReason = pendingFullSnapshotIsInitial
      ? 'initial_' + reason
      : reason
    var shouldDiscardTail =
      pendingFullSnapshotRequiresTailDiscard
    cancelScheduledFullSnapshot()
    clearDeferredRecords()
    resetPreviousReplayTreeRecords()
    previousReplayTreeAdmissionActive = false
    captureRecordsAgainstPreviousReplayTree = false
    previousPublishedReplayTree = undefined
    if (
      shouldDiscardTail &&
      options.$rOnMandatoryFullSnapshotAbandoned
    ) {
      options.$rOnMandatoryFullSnapshotAbandoned()
    }
    stopRecording(undefined, true)
    if (options.onFullSnapshotFailure) {
      options.onFullSnapshotFailure(failureReason)
    }
  }

  function takeSubsequentFullSnapshot(timestamp, canBeDiscarded) {
    // A public, best-effort snapshot must never replace an in-flight recovery
    // transaction.  The recovery may already have retired stateful records or
    // the previous replay chain, so downgrading it would make abandon unsafe.
    if (
      canBeDiscarded &&
      pendingFullSnapshotTimestamp !== undefined
    ) {
      return
    }
    var shouldRunAfterRestart = Boolean(pendingFullSnapshotTask)
    scheduleSubsequentFullSnapshot(
      timestamp,
      Boolean(canBeDiscarded)
    )
    runPendingFullSnapshotSliceSafely(true)
    if (shouldRunAfterRestart && pendingFullSnapshotTask) {
      runPendingFullSnapshotSliceSafely(true)
    }
  }

  function flushScheduledFullSnapshot(
    skipRecoveryRestore,
    supersedeForView
  ) {
    if (
      supersedeForView &&
      pendingFullSnapshotTimestamp !== undefined
    ) {
      // The next view starts its own baseline transaction. Discard every held
      // tail from the old view before ViewEnd is emitted.
      abandonPendingFullSnapshot(true)
      return true
    }
    if (
      pendingFullSnapshotCanBeDiscarded &&
      captureRecordsAgainstPreviousReplayTree
    ) {
      // Detect native main/shadow mutations that have not reached their async
      // callbacks before deciding that an optional candidate may abandon.
      capturePendingMutationActivityForPreviousReplayTree(true)
    }
    if (failPendingFullSnapshotOnTimeout()) {
      return true
    }
    if (pendingFullSnapshotBaselineRecords) {
      // Serialization already completed. Retry the exact baseline transaction
      // instead of treating the intentionally empty serializer task as an
      // incomplete snapshot. On unload this hook is invoked again after the
      // encoder is synchronously drained, so the same objects get one more
      // admission opportunity before teardown.
      if (runPendingFullSnapshotSliceSafely(false)) {
        return true
      }
      if (!pendingFullSnapshotBaselineRecords) {
        return true
      }
      if (
        skipRecoveryRestore ||
        pendingFullSnapshotCanBeDiscarded
      ) {
        abandonPendingFullSnapshot(skipRecoveryRestore)
      } else {
        schedulePendingFullSnapshotSlice(
          MUTATION_ADMISSION_RETRY_DELAY_MS
        )
      }
      return true
    }
    if (!pendingFullSnapshotTask) {
      if (pendingFullSnapshotTimestamp === undefined) {
        return false
      }
      if (
        skipRecoveryRestore ||
        pendingFullSnapshotCanBeDiscarded
      ) {
        abandonPendingFullSnapshot(skipRecoveryRestore)
      } else {
        failFullSnapshot('full_snapshot_incomplete_at_flush')
      }
      return true
    }
    if (pendingFullSnapshotCanBeDiscarded) {
      abandonPendingFullSnapshot(skipRecoveryRestore)
      return true
    }
    clearPendingFullSnapshotTimeout()
    if (
      pendingFullSnapshotRestartRequested ||
      pendingFullSnapshotMutationVersion !== domMutationVersion
    ) {
      restartPendingFullSnapshot(false)
      if (!pendingFullSnapshotTask || recordStopped) {
        return true
      }
    }
    var completed = runPendingFullSnapshotSliceSafely(false)
    // Teardown and view-boundary flushes must remain one bounded slice. A
    // synchronous loop here could spend the full one-second recovery budget
    // on the main thread and turn stop() into a long task.
    if (!completed && pendingFullSnapshotTask) {
      if (pendingFullSnapshotCanBeDiscarded) {
        abandonPendingFullSnapshot(skipRecoveryRestore)
      } else {
        failFullSnapshot('full_snapshot_incomplete_at_flush')
      }
    }
    return true
  }

  function scheduleSubsequentFullSnapshot(
    timestamp,
    canBeDiscarded,
    requiresTailDiscard
  ) {
    if (pendingFullSnapshotTimestamp !== undefined) {
      // Any request arriving while a replacement baseline is being built must
      // reuse the same bounded transaction. Re-running begin() would reset its
      // restart/time budget and let sustained mutation churn spin forever.
      var nextFullSnapshotTimestamp =
        typeof timestamp === 'undefined' ? timeStampNow() : timestamp
      pendingFullSnapshotTimestamp = Math.max(
        pendingFullSnapshotTimestamp,
        nextFullSnapshotTimestamp,
        previousReplayTreeLastRecordTimestamp || 0
      )
      if (!canBeDiscarded) {
        pendingFullSnapshotCanBeDiscarded = false
      }
      if (
        requiresTailDiscard &&
        !pendingFullSnapshotRequiresTailDiscard
      ) {
        pendingFullSnapshotRequiresTailDiscard = true
        pendingFullSnapshotCanBeDiscarded = false
        previousReplayTreeAdmissionActive = false
        captureRecordsAgainstPreviousReplayTree = false
        resetPreviousReplayTreeRecords()
        if (options.$rOnMandatoryFullSnapshotStarted) {
          options.$rOnMandatoryFullSnapshotStarted()
        }
      }
      if (pendingFullSnapshotTask) {
        pendingFullSnapshotRestartRequested = true
      }
      schedulePendingFullSnapshotSlice(
        pendingFullSnapshotTask
          ? 0
          : FULL_SNAPSHOT_MUTATION_QUIET_DELAY_MS
      )
      return
    }
    if (
      beginSubsequentFullSnapshot(
        timestamp,
        canBeDiscarded,
        requiresTailDiscard
      )
    ) {
      schedulePendingFullSnapshotSlice()
    }
  }

  function stopRecording(_flushReason, skipPendingFlush) {
    if (recordStopping || recordStopped) {
      return
    }
    // Keep the final bounded mutation drain, but prevent an overflow found by
    // that drain from starting a replacement full snapshot that teardown would
    // immediately discard.
    recordStopping = true
    var firstCleanupError
    try {
      if (pendingFullSnapshotIsInitial) {
        // An initial snapshot has no published tail to finalize. Teardown must
        // cancel its timer/task instead of forcing another slice or reporting
        // a failure for an intentional stop.
        cancelScheduledFullSnapshot()
      } else if (!skipPendingFlush && !flushScheduledFullSnapshot(true)) {
        // Capture small records still queued by native MutationObservers.
        // Oversized subtree serialization is discarded once its synchronous
        // budget is exhausted.
        var finalMutationFlushResult = flushMutations(true)
        if (finalMutationFlushResult === 'pending') {
          // Chunked callbacks are published only when their final chunk closes,
          // so teardown drops the whole tail and leaves the replay at its last
          // consistent state. Never report the bounded drain as successful.
          addTelemetryDebug(
            'Session Replay dropped a pending mutation transaction during teardown.',
            { reason: 'stop_mutation_tail_pending' }
          )
        }
      }
    } catch (error) {
      firstCleanupError = error
    }
    recordStopped = true
    ;[
      function () {
        clearInterval(replayTimeAnchorIntervalId)
      },
      discardPendingMutationAdmissions,
      cancelMutationSourceFlushContinuation,
      cancelScheduledFullSnapshot,
      invalidateFullSnapshotCanvasBaseline,
      function () {
        suppressRecordsUntilFullSnapshot = false
        previousReplayTreeAdmissionActive = false
        captureRecordsAgainstPreviousReplayTree = false
      },
      clearDeferredRecords,
      clearPreviousReplayTreeRecords,
      shadowRootsController.stop,
      canvasCommandCapture.stop,
      canvasWebGLSnapshotObserver.stop,
      canvasObserver.stop,
      function () {
        stopCanvasSnapshots(canvasSnapshotLoop)
      },
      stopObservers,
      inputObserver,
      stopSerializedCanvasTracking
    ].forEach(function (cleanupTask) {
      try {
        cleanupTask()
      } catch (error) {
        if (!firstCleanupError) {
          firstCleanupError = error
        }
      }
    })
    if (firstCleanupError) {
      addTelemetryDebug('Session Replay recorder cleanup failed.', {
        reason: _flushReason,
        error: String(firstCleanupError)
      })
    }
  }

  var recorder = {
    stop: stopRecording,
    $rEmitTimeAnchor: emitReplayTimeAnchor,
    $rFlushCanvasCommands: function () {
      // A previous boundary pass may have preserved the exact Canvas record
      // after transient segment/encoder backpressure. Retry that object before
      // creating a newer command batch so unload's second writable pass keeps
      // command ordering and can use the segment serialization cache.
      try {
        flushDeferredRecords()
      } catch (_) {}
      try {
        if (canvasCommandCapture.flush) {
          canvasCommandCapture.flush()
        }
      } catch (_) {}
    },
    snapshotCanvas: function (canvas, snapshotOptions) {
      return snapshotCanvasIfActive(
        canvas,
        assign({ trigger: 'manual' }, snapshotOptions)
      )
    },
    getSerializedNodeIdForDebug: function (node) {
      return getActiveSerializedNodeId(node)
    },
    takeSubsequentFullSnapshot: takeSubsequentFullSnapshot,
    flushScheduledFullSnapshot: flushScheduledFullSnapshot,
    scheduleSubsequentFullSnapshot: scheduleSubsequentFullSnapshot,
    prepareForViewChange: prepareForViewChange,
    flushMutations: flushMutations,
    shadowRootsController: shadowRootsController
  }
  if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
    assign(recorder, {
      getLastAutoCanvasSnapshotResultForDebug: function () {
        return cloneAutoCanvasSnapshotDebugResult(lastAutoCanvasSnapshotResult)
      },
      getAutoCanvasSnapshotDebugHistoryForDebug: function () {
        return autoCanvasSnapshotDebugHistoryForDebug.map(
          cloneAutoCanvasSnapshotDebugResult
        )
      },
      getLastCanvasMutationForDebug: function () {
        return cloneCanvasMutationDebugResult(lastCanvasMutationForDebug)
      },
      getCanvasMutationHistoryForDebug: function () {
        return canvasMutationHistoryForDebug.map(
          cloneCanvasMutationDebugResult
        )
      },
      getLastDomMutationForDebug: function () {
        return cloneDomMutationDebugResult(lastDomMutationForDebug)
      },
      getDomMutationHistoryForDebug: function () {
        return domMutationHistoryForDebug.map(cloneDomMutationDebugResult)
      },
      getReplayPerformanceForDebug: function () {
        return cloneReplayPerformanceStats(replayPerformanceStats)
      }
    })
  }
  return recorder
}

function createInactiveRecorder() {
  var noop = function () {}
  var recorder = {
    stop: noop,
    $rEmitTimeAnchor: noop,
    $rFlushCanvasCommands: noop,
    snapshotCanvas: noop,
    getSerializedNodeIdForDebug: noop,
    takeSubsequentFullSnapshot: noop,
    flushScheduledFullSnapshot: function () {
      return false
    },
    scheduleSubsequentFullSnapshot: noop,
    prepareForViewChange: noop,
    flushMutations: noop
  }
  if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
    assign(recorder, {
      getLastAutoCanvasSnapshotResultForDebug: noop,
      getAutoCanvasSnapshotDebugHistoryForDebug: function () {
        return []
      },
      getLastCanvasMutationForDebug: noop,
      getCanvasMutationHistoryForDebug: function () {
        return []
      },
      getLastDomMutationForDebug: noop,
      getDomMutationHistoryForDebug: function () {
        return []
      },
      getReplayPerformanceForDebug: noop
    })
  }
  return recorder
}

function materializeMutationPayload(pendingMutationPayload) {
  return {
    adds: pendingMutationPayload.adds,
    removes: pendingMutationPayload.removes,
    texts: pendingMutationPayload.texts,
    attributes: pendingMutationPayload.attributes
  }
}

function createEmptyMutationPayload() {
  return {
    adds: [],
    removes: [],
    texts: [],
    attributes: [],
    approxBytes: 0,
    addsApproxBytes: 0,
    removesApproxBytes: 0,
    textsApproxBytes: 0,
    attributesApproxBytes: 0,
    addApproxBytes: [],
    removesByKey: new Map(),
    removeApproxBytesByKey: new Map(),
    textsById: new Map(),
    textApproxBytesById: new Map(),
    attributesById: new Map(),
    attributeApproxBytesById: new Map()
  }
}

function mergeMutationPayloads(target, source, measurements) {
  var merged = target || createEmptyMutationPayload()
  mergeAddMutations(merged, source.adds, measurements.adds)
  mergeRemoveMutations(merged, source.removes, measurements.removes)
  mergeTextMutations(merged, source.texts, measurements.texts)
  mergeAttributeMutations(merged, source.attributes, measurements.attributes)
  updateMutationPayloadApproxBytes(merged)
  return merged
}

function mergeAddMutations(merged, sourceAdds, sourceMeasurements) {
  if (!sourceAdds.length) {
    return
  }

  sourceAdds.forEach(function (add, index) {
    var addApproxBytes = sourceMeasurements[index]
    merged.adds.push(add)
    merged.addApproxBytes.push(addApproxBytes)
    merged.addsApproxBytes += addApproxBytes
  })
}

function mergeRemoveMutations(merged, sourceRemoves, sourceMeasurements) {
  if (!sourceRemoves.length) {
    return
  }
  sourceRemoves.forEach(function (remove, index) {
    var key = getRemoveMutationKey(remove)
    if (!merged.removesByKey.has(key)) {
      merged.removes.push(remove)
      var removeApproxBytes = sourceMeasurements[index]
      merged.removeApproxBytesByKey.set(key, removeApproxBytes)
      merged.removesApproxBytes += removeApproxBytes
    }
    merged.removesByKey.set(key, remove)
  })
}

function mergeTextMutations(merged, sourceTexts, sourceMeasurements) {
  if (!sourceTexts.length) {
    return
  }
  sourceTexts.forEach(function (textMutation, index) {
    var existingTextMutation = merged.textsById.get(textMutation.id)
    if (existingTextMutation) {
      merged.textsApproxBytes -=
        merged.textApproxBytesById.get(textMutation.id) || 0
      existingTextMutation.value = textMutation.value
      var nextTextApproxBytes = sourceMeasurements[index]
      merged.textApproxBytesById.set(textMutation.id, nextTextApproxBytes)
      merged.textsApproxBytes += nextTextApproxBytes
      return
    }
    merged.texts.push(textMutation)
    merged.textsById.set(textMutation.id, textMutation)
    var textApproxBytes = sourceMeasurements[index]
    merged.textApproxBytesById.set(textMutation.id, textApproxBytes)
    merged.textsApproxBytes += textApproxBytes
  })
}

function mergeAttributeMutations(merged, sourceAttributes, sourceMeasurements) {
  if (!sourceAttributes.length) {
    return
  }

  sourceAttributes.forEach(function (attributeMutation, index) {
    var existingAttributeMutation = merged.attributesById.get(attributeMutation.id)
    if (!existingAttributeMutation) {
      var nextAttributeMutation = {
        id: attributeMutation.id,
        attributes: assign({}, attributeMutation.attributes)
      }
      merged.attributes.push(nextAttributeMutation)
      merged.attributesById.set(attributeMutation.id, nextAttributeMutation)
      var attributeApproxBytes = sourceMeasurements[index]
      merged.attributeApproxBytesById.set(
        attributeMutation.id,
        attributeApproxBytes
      )
      merged.attributesApproxBytes += attributeApproxBytes
      return
    }
    merged.attributesApproxBytes -=
      merged.attributeApproxBytesById.get(attributeMutation.id) || 0
    existingAttributeMutation.attributes = assign(
      existingAttributeMutation.attributes,
      attributeMutation.attributes
    )
    var nextAttributeApproxBytes = estimateMutationEntryBytes(
      existingAttributeMutation
    )
    merged.attributeApproxBytesById.set(
      attributeMutation.id,
      nextAttributeApproxBytes
    )
    merged.attributesApproxBytes += nextAttributeApproxBytes
  })
}

function getRemoveMutationKey(remove) {
  return remove.parentId + ':' + remove.id
}

function shouldFlushPendingMutationPayloadBeforeMerge(
  target,
  source,
  sourceApproxBytes,
  pendingPublicationTokenByNode,
  pendingNodeParentByNode,
  wasNodePublishedBeforePendingMutation
) {
  // Structural arrays do not encode the order in which separate callbacks
  // happened. Keep callback boundaries around adds/removes so a short-lived
  // add cannot be replayed after its later remove. The exception is a move
  // reported by different document/ShadowRoot observers: its add and remove
  // share one private publication token and must reach the player atomically.
  if (
    hasStructuralMutationEntries(target) ||
    hasStructuralMutationEntries(source)
  ) {
    return !hasCrossCallbackMoveDependency(
      target,
      source,
      pendingPublicationTokenByNode,
      pendingNodeParentByNode,
      wasNodePublishedBeforePendingMutation
    )
  }
  return (
    target.approxBytes + sourceApproxBytes >
    MAX_MUTATION_EMIT_APPROX_BYTES
  )
}

function hasStructuralMutationEntries(mutation) {
  return mutation.adds.length > 0 || mutation.removes.length > 0
}

function hasCrossCallbackMoveDependency(
  first,
  second,
  pendingPublicationTokenByNode,
  pendingNodeParentByNode,
  wasNodePublishedBeforePendingMutation
) {
  return (
    hasRemoveToAddDependency(
      first.removes,
      second.adds,
      second.removes,
      pendingPublicationTokenByNode,
      pendingNodeParentByNode,
      wasNodePublishedBeforePendingMutation
    ) ||
    hasRemoveToAddDependency(
      second.removes,
      first.adds,
      first.removes,
      pendingPublicationTokenByNode,
      pendingNodeParentByNode,
      wasNodePublishedBeforePendingMutation
    )
  )
}

function hasRemoveToAddDependency(
  removes,
  adds,
  removesAlreadyPairedWithAdds,
  pendingPublicationTokenByNode,
  pendingNodeParentByNode,
  wasNodePublishedBeforePendingMutation
) {
  if (!removes.length || !adds.length) {
    return false
  }
  var addPublicationTokens = new Set()
  adds.forEach(function (add) {
    var publicationToken = getMutationAddPublicationToken(add)
    if (publicationToken) {
      addPublicationTokens.add(publicationToken)
    }
  })
  // A later remove is a new transition when the same node (or an ancestor in
  // the staged add tree) was already paired with this add. Keep sibling removes
  // eligible: one add token can contain nodes moved from several observers.
  var pairedRemovedNodesByPublicationToken = new Map()
  removesAlreadyPairedWithAdds.forEach(function (remove) {
    var removedNode = getMutationRemoveSourceNode(remove)
    if (
      removedNode &&
      wasNodePublishedBeforePendingMutation(removedNode)
    ) {
      var publicationToken =
        pendingPublicationTokenByNode.get(removedNode)
      if (addPublicationTokens.has(publicationToken)) {
        var pairedRemovedNodes =
          pairedRemovedNodesByPublicationToken.get(publicationToken)
        if (!pairedRemovedNodes) {
          pairedRemovedNodes = new Set()
          pairedRemovedNodesByPublicationToken.set(
            publicationToken,
            pairedRemovedNodes
          )
        }
        pairedRemovedNodes.add(removedNode)
      }
    }
  })
  return removes.some(function (remove) {
    var removedNode = getMutationRemoveSourceNode(remove)
    var publicationToken =
      removedNode && pendingPublicationTokenByNode.get(removedNode)
    return Boolean(
      removedNode &&
        wasNodePublishedBeforePendingMutation(removedNode) &&
        addPublicationTokens.has(publicationToken) &&
        !isNodeCoveredByPairedRemove(
          removedNode,
          pairedRemovedNodesByPublicationToken.get(publicationToken),
          pendingNodeParentByNode
        )
    )
  })
}

function isNodeCoveredByPairedRemove(
  node,
  pairedRemovedNodes,
  pendingNodeParentByNode
) {
  if (!pairedRemovedNodes) {
    return false
  }
  var current = node
  var depth = 0
  while (current && depth < MAX_SERIALIZED_NODE_ANCESTOR_DEPTH) {
    if (pairedRemovedNodes.has(current)) {
      return true
    }
    current = pendingNodeParentByNode.get(current)
    depth += 1
  }
  return false
}

function splitPendingMutationPayloadForEmit(
  pendingMutationPayload,
  pendingPublicationTokenByNode,
  wasNodePublishedBeforePendingMutation
) {
  if (pendingMutationPayload.approxBytes <= MAX_MUTATION_EMIT_APPROX_BYTES) {
    return {
      mutationEntries: [
        [
          materializeMutationPayload(pendingMutationPayload),
          pendingMutationPayload.approxBytes
        ]
      ],
      hasOversizedEntry: false
    }
  }

  var mutationEntries = []
  var currentMutation = createEmptyMutation()
  var currentMutationBytes = BASE_MUTATION_PAYLOAD_APPROX_BYTES
  var currentStructuralKind
  var hasOversizedEntry = false
  var structuralComponents = createStructuralMutationComponents(
    pendingMutationPayload,
    pendingPublicationTokenByNode,
    wasNodePublishedBeforePendingMutation
  )
  if (
    !structuralComponents ||
    structuralComponents.some(function (component) {
      return (
        BASE_MUTATION_PAYLOAD_APPROX_BYTES + component.approxBytes >
        MAX_MUTATION_EMIT_APPROX_BYTES
      )
    })
  ) {
    return {
      mutationEntries: [],
      hasOversizedEntry: true
    }
  }

  function pushCurrentMutation() {
    if (!hasMutationEntries(currentMutation)) {
      return
    }
    mutationEntries.push([currentMutation, currentMutationBytes])
    currentMutation = createEmptyMutation()
    currentMutationBytes = BASE_MUTATION_PAYLOAD_APPROX_BYTES
    currentStructuralKind = undefined
  }

  function appendEntry(type, entry, entryBytes) {
    if (
      BASE_MUTATION_PAYLOAD_APPROX_BYTES + entryBytes >
      MAX_MUTATION_EMIT_APPROX_BYTES
    ) {
      hasOversizedEntry = true
      return
    }
    if (
      hasMutationEntries(currentMutation) &&
      currentMutationBytes + entryBytes > MAX_MUTATION_EMIT_APPROX_BYTES
    ) {
      pushCurrentMutation()
    }
    currentMutation[type].push(entry)
    currentMutationBytes += entryBytes
  }

  structuralComponents.forEach(function (component) {
    var componentStructuralKind = component.removes.length
      ? 'dependent'
      : 'add'
    if (
      hasMutationEntries(currentMutation) &&
      (currentStructuralKind !== componentStructuralKind ||
        currentMutationBytes + component.approxBytes >
          MAX_MUTATION_EMIT_APPROX_BYTES)
    ) {
      pushCurrentMutation()
    }
    component.adds.forEach(function (addEntry) {
      currentMutation.adds.push(addEntry.entry)
    })
    component.removes.forEach(function (removeEntry) {
      currentMutation.removes.push(removeEntry.entry)
    })
    currentMutationBytes += component.approxBytes
    currentStructuralKind = componentStructuralKind
  })
  pushCurrentMutation()
  pendingMutationPayload.texts.forEach(function (textMutation) {
    appendEntry(
      'texts',
      textMutation,
      pendingMutationPayload.textApproxBytesById.get(textMutation.id) ||
        estimateMutationEntryBytes(textMutation)
    )
  })
  pendingMutationPayload.attributes.forEach(function (attributeMutation) {
    appendEntry(
      'attributes',
      attributeMutation,
      pendingMutationPayload.attributeApproxBytesById.get(
        attributeMutation.id
      ) || estimateMutationEntryBytes(attributeMutation)
    )
  })
  pushCurrentMutation()

  return {
    mutationEntries: mutationEntries,
    hasOversizedEntry: hasOversizedEntry
  }
}

function createStructuralMutationComponents(
  pendingMutationPayload,
  pendingPublicationTokenByNode,
  wasNodePublishedBeforePendingMutation
) {
  var structuralEntries = []
  var entriesByParentId = new Map()
  var addEntryIndexByPublicationToken = new Map()

  function appendStructuralEntry(type, entry, approxBytes) {
    var entryIndex = structuralEntries.length
    var structuralEntry = {
      type: type,
      entry: entry,
      approxBytes: approxBytes,
      parent: entryIndex
    }
    structuralEntries.push(structuralEntry)
    var parentEntries = entriesByParentId.get(entry.parentId)
    if (!parentEntries) {
      parentEntries = {
        adds: [],
        removes: []
      }
      entriesByParentId.set(entry.parentId, parentEntries)
    }
    parentEntries[type].push(entryIndex)
    if (type === 'adds') {
      var publicationToken = getMutationAddPublicationToken(entry)
      if (publicationToken) {
        addEntryIndexByPublicationToken.set(publicationToken, entryIndex)
      }
    }
  }

  pendingMutationPayload.adds.forEach(function (add, index) {
    appendStructuralEntry(
      'adds',
      add,
      pendingMutationPayload.addApproxBytes[index]
    )
  })
  pendingMutationPayload.removes.forEach(function (remove) {
    appendStructuralEntry(
      'removes',
      remove,
      pendingMutationPayload.removeApproxBytesByKey.get(
        getRemoveMutationKey(remove)
      ) || estimateMutationEntryBytes(remove)
    )
  })

  function findRoot(entryIndex) {
    var structuralEntry = structuralEntries[entryIndex]
    while (structuralEntry.parent !== entryIndex) {
      structuralEntry.parent =
        structuralEntries[structuralEntry.parent].parent
      entryIndex = structuralEntry.parent
      structuralEntry = structuralEntries[entryIndex]
    }
    return entryIndex
  }

  function connectEntries(firstEntryIndex, secondEntryIndex) {
    var firstRoot = findRoot(firstEntryIndex)
    var secondRoot = findRoot(secondEntryIndex)
    if (firstRoot !== secondRoot) {
      structuralEntries[secondRoot].parent = firstRoot
    }
  }

  // A remove and its replacement additions must be replayed together. Keep
  // this dependency scoped to the mutated parent instead of turning every
  // replacement in the pending window into one global transaction.
  entriesByParentId.forEach(function (parentEntries) {
    if (!parentEntries.adds.length || !parentEntries.removes.length) {
      return
    }
    var firstEntryIndex = parentEntries.adds[0]
    parentEntries.adds.slice(1).forEach(function (entryIndex) {
      connectEntries(firstEntryIndex, entryIndex)
    })
    parentEntries.removes.forEach(function (entryIndex) {
      connectEntries(firstEntryIndex, entryIndex)
    })
  })

  // A published move can cross document and ShadowRoot observers. The source
  // node carries the destination add's private publication token, which is the
  // causal edge joining the source and destination parent components.
  structuralEntries.forEach(function (structuralEntry, entryIndex) {
    if (structuralEntry.type !== 'removes') {
      return
    }
    var removedNode = getMutationRemoveSourceNode(structuralEntry.entry)
    if (
      !removedNode ||
      !wasNodePublishedBeforePendingMutation(removedNode)
    ) {
      return
    }
    var addEntryIndex = addEntryIndexByPublicationToken.get(
      pendingPublicationTokenByNode.get(removedNode)
    )
    if (typeof addEntryIndex === 'number') {
      connectEntries(entryIndex, addEntryIndex)
    }
  })

  var componentsByRoot = new Map()
  structuralEntries.forEach(function (structuralEntry, entryIndex) {
    var root = findRoot(entryIndex)
    var component = componentsByRoot.get(root)
    if (!component) {
      component = {
        adds: [],
        removes: [],
        approxBytes: 0,
        sequence: entryIndex,
        dependencies: new Set()
      }
      componentsByRoot.set(root, component)
    }
    component[structuralEntry.type].push(structuralEntry)
    component.approxBytes += structuralEntry.approxBytes
    component.sequence = Math.min(component.sequence, entryIndex)
  })

  var components = Array.from(componentsByRoot.values())
  var addComponentByNodeId = new Map()
  components.forEach(function (component) {
    component.adds.forEach(function (addEntry) {
      addComponentByNodeId.set(addEntry.entry.node.id, component)
    })
  })
  components.forEach(function (component) {
    component.adds.forEach(function (addEntry) {
      var dependencyNodeIds = [
        addEntry.entry.parentId,
        addEntry.entry.nextId
      ]
      dependencyNodeIds.forEach(function (dependencyNodeId) {
        var dependencyComponent =
          addComponentByNodeId.get(dependencyNodeId)
        if (
          dependencyComponent &&
          dependencyComponent !== component
        ) {
          component.dependencies.add(dependencyComponent)
        }
      })
    })
  })

  // Mutation serialization orders sibling roots so an add's nextId is already
  // published. Preserve that ordering across split payloads, including when a
  // replacement or move has joined entries that were originally separate.
  components.sort(function (first, second) {
    return first.sequence - second.sequence
  })
  var orderedComponents = []
  var visitedComponents = new Set()
  var visitingComponents = new Set()
  var hasDependencyCycle = false
  function visitComponent(component) {
    if (visitedComponents.has(component)) {
      return
    }
    if (visitingComponents.has(component)) {
      hasDependencyCycle = true
      return
    }
    visitingComponents.add(component)
    Array.from(component.dependencies)
      .sort(function (first, second) {
        return first.sequence - second.sequence
      })
      .forEach(visitComponent)
    visitingComponents.delete(component)
    visitedComponents.add(component)
    orderedComponents.push(component)
  }
  components.forEach(visitComponent)
  return hasDependencyCycle ? undefined : orderedComponents
}

function partitionMutationPayloadByEntrySize(mutation, measurements) {
  var safeMutation = createEmptyMutation()
  var safeMeasurements = {
    adds: [],
    removes: [],
    texts: [],
    attributes: [],
    approxBytes: BASE_MUTATION_PAYLOAD_APPROX_BYTES
  }
  var hasOversizedEntry = false

  ;['adds', 'removes', 'texts', 'attributes'].forEach(function (type) {
    mutation[type].forEach(function (entry, index) {
      var entryBytes = measurements[type][index]
      if (
        BASE_MUTATION_PAYLOAD_APPROX_BYTES + entryBytes >
        MAX_MUTATION_EMIT_APPROX_BYTES
      ) {
        hasOversizedEntry = true
        return
      }
      safeMutation[type].push(entry)
      safeMeasurements[type].push(entryBytes)
      safeMeasurements.approxBytes += entryBytes
    })
  })

  return {
    mutation: safeMutation,
    measurements: safeMeasurements,
    hasOversizedEntry: hasOversizedEntry
  }
}

function hasOversizedMutationEntry(measurements) {
  return ['adds', 'removes', 'texts', 'attributes'].some(function (type) {
    return measurements[type].some(function (entryBytes) {
      return (
        BASE_MUTATION_PAYLOAD_APPROX_BYTES + entryBytes >
        MAX_MUTATION_EMIT_APPROX_BYTES
      )
    })
  })
}

function createEmptyMutation() {
  return {
    adds: [],
    removes: [],
    texts: [],
    attributes: []
  }
}

function hasMutationEntries(mutation) {
  return (
    mutation.adds.length > 0 ||
    mutation.removes.length > 0 ||
    mutation.texts.length > 0 ||
    mutation.attributes.length > 0
  )
}

var BASE_MUTATION_PAYLOAD_APPROX_BYTES = 64
function measureMutationPayload(mutation) {
  var measurements = {
    adds: measureMutationEntries(mutation.adds),
    removes: measureMutationEntries(mutation.removes),
    texts: measureMutationEntries(mutation.texts),
    attributes: measureMutationEntries(mutation.attributes)
  }
  measurements.approxBytes =
    BASE_MUTATION_PAYLOAD_APPROX_BYTES +
    sumMutationEntryMeasurements(measurements.adds) +
    sumMutationEntryMeasurements(measurements.removes) +
    sumMutationEntryMeasurements(measurements.texts) +
    sumMutationEntryMeasurements(measurements.attributes)
  return measurements
}

function estimateMutationEntryBytes(entry) {
  var approxBytes = 2
  Object.keys(entry).forEach(function (key) {
    approxBytes += estimateMutationJsonStringBytes(key) + 2
    if (key === 'node') {
      approxBytes +=
        getSerializedNodeApproxBytes(entry.node) ||
        estimateJsonValueBytes(entry.node)
    } else {
      approxBytes += estimateJsonValueBytes(entry[key])
    }
  })
  return approxBytes
}

function estimateJsonValueBytes(value, maxApproxBytes) {
  if (typeof maxApproxBytes !== 'number') {
    maxApproxBytes = MAX_MUTATION_EMIT_APPROX_BYTES
  }
  var approxBytes = 0
  var pendingValues = [value]
  while (
    pendingValues.length &&
    approxBytes <= maxApproxBytes
  ) {
    var current = pendingValues.pop()
    if (typeof current === 'string') {
      approxBytes += estimateMutationJsonStringBytes(current, maxApproxBytes)
    } else if (typeof current === 'number') {
      approxBytes += 16
    } else if (typeof current === 'boolean') {
      approxBytes += 5
    } else if (current && typeof current === 'object') {
      if (Array.isArray(current)) {
        approxBytes += current.length + 2
        for (var index = 0; index < current.length; index += 1) {
          pendingValues.push(current[index])
        }
      } else {
        Object.keys(current).forEach(function (key) {
          approxBytes += estimateMutationJsonStringBytes(key) + 2
          pendingValues.push(current[key])
        })
      }
    } else {
      approxBytes += 4
    }
  }
  return approxBytes
}

function estimateMutationJsonStringBytes(value, maxApproxBytes) {
  if (typeof maxApproxBytes !== 'number') {
    maxApproxBytes = MAX_MUTATION_EMIT_APPROX_BYTES
  }
  if (value.length * 2 + 4 > maxApproxBytes) {
    return maxApproxBytes + 1
  }
  var bytes = 4
  for (var index = 0; index < value.length; index += 1) {
    var characterCode = value.charCodeAt(index)
    bytes +=
      characterCode <= 0x1f ||
      characterCode === 0x22 ||
      characterCode === 0x5c
        ? 12
        : 2
    if (bytes > maxApproxBytes) {
      return bytes
    }
  }
  return bytes
}

function measureMutationEntries(entries) {
  var measurements = []
  for (var i = 0; i < entries.length; i += 1) {
    measurements.push(estimateMutationEntryBytes(entries[i]))
  }
  return measurements
}

function sumMutationEntryMeasurements(measurements) {
  var total = 0
  for (var i = 0; i < measurements.length; i += 1) {
    total += measurements[i]
  }
  return total
}

function updateMutationPayloadApproxBytes(mutationPayload) {
  mutationPayload.approxBytes =
    BASE_MUTATION_PAYLOAD_APPROX_BYTES +
    mutationPayload.addsApproxBytes +
    mutationPayload.removesApproxBytes +
    mutationPayload.textsApproxBytes +
    mutationPayload.attributesApproxBytes
}

function createReplayPerformanceStats() {
  return {
    processMutationsCount: 0,
    processMutationsDuration: 0,
    mutationSerializationCount: 0,
    mutationSerializationDuration: 0,
    mutationLocalDropCount: 0,
    mutationLocalDropLastReason: undefined,
    mutationDropRecoveryCount: 0,
    mutationDropRecoveryLastReason: undefined,
    admissionGapRecoveryCount: 0,
    admissionGapRecoveryLastReason: undefined,
    mutationCallbackCount: 0,
    mutationRecordCount: 0,
    mutationAddCount: 0,
    mutationRemoveCount: 0,
    mutationTextCount: 0,
    mutationAttributeCount: 0,
    fullSnapshotCount: 0,
    fullSnapshotDuration: 0
  }
}

function accumulateReplayPerformanceStats(stats, delta) {
  if (!delta) {
    return
  }

  stats.processMutationsCount += delta.processMutationsCount || 0
  stats.processMutationsDuration += delta.processMutationsDuration || 0
  stats.mutationSerializationCount += delta.mutationSerializationCount || 0
  stats.mutationSerializationDuration +=
    delta.mutationSerializationDuration || 0
  stats.mutationLocalDropCount += delta.mutationLocalDropCount || 0
  if (delta.mutationLocalDropReason) {
    stats.mutationLocalDropLastReason = delta.mutationLocalDropReason
  }
  stats.mutationDropRecoveryCount += delta.mutationDropRecoveryCount || 0
  if (delta.mutationDropRecoveryLastReason) {
    stats.mutationDropRecoveryLastReason =
      delta.mutationDropRecoveryLastReason
  }
  stats.admissionGapRecoveryCount += delta.admissionGapRecoveryCount || 0
  if (delta.admissionGapRecoveryLastReason) {
    stats.admissionGapRecoveryLastReason =
      delta.admissionGapRecoveryLastReason
  }
  stats.mutationCallbackCount += delta.mutationCallbackCount || 0
  stats.mutationRecordCount += delta.mutationRecordCount || 0
  stats.mutationAddCount += delta.mutationAddCount || 0
  stats.mutationRemoveCount += delta.mutationRemoveCount || 0
  stats.mutationTextCount += delta.mutationTextCount || 0
  stats.mutationAttributeCount += delta.mutationAttributeCount || 0
  stats.fullSnapshotCount += delta.fullSnapshotCount || 0
  stats.fullSnapshotDuration += delta.fullSnapshotDuration || 0
}

function countMutationPayloadRecords(mutation) {
  return (
    mutation.adds.length +
    mutation.removes.length +
    mutation.texts.length +
    mutation.attributes.length
  )
}

function cloneReplayPerformanceStats(stats) {
  if (!stats) {
    return stats
  }

  return {
    processMutationsCount: stats.processMutationsCount,
    processMutationsDuration:
      Math.round(stats.processMutationsDuration * 10) / 10,
    mutationSerializationCount: stats.mutationSerializationCount,
    mutationSerializationDuration:
      Math.round(stats.mutationSerializationDuration * 10) / 10,
    mutationLocalDropCount: stats.mutationLocalDropCount,
    mutationLocalDropLastReason: stats.mutationLocalDropLastReason,
    mutationDropRecoveryCount: stats.mutationDropRecoveryCount,
    mutationDropRecoveryLastReason:
      stats.mutationDropRecoveryLastReason,
    admissionGapRecoveryCount: stats.admissionGapRecoveryCount,
    admissionGapRecoveryLastReason:
      stats.admissionGapRecoveryLastReason,
    mutationCallbackCount: stats.mutationCallbackCount,
    mutationRecordCount: stats.mutationRecordCount,
    mutationAddCount: stats.mutationAddCount,
    mutationRemoveCount: stats.mutationRemoveCount,
    mutationTextCount: stats.mutationTextCount,
    mutationAttributeCount: stats.mutationAttributeCount,
    fullSnapshotCount: stats.fullSnapshotCount,
    fullSnapshotDuration:
      Math.round(stats.fullSnapshotDuration * 10) / 10
  }
}

function getPerformanceTime() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

function pushCanvasDebugHistoryEntry(history, entry, limit) {
  if (!entry) {
    return
  }

  if (typeof limit !== 'number') {
    limit = CANVAS_DEBUG_HISTORY_LIMIT
  }
  history.push(entry)
  if (history.length > limit) {
    history.shift()
  }
}

function stopCanvasSnapshots(canvasSnapshotLoop) {
  if (typeof canvasSnapshotLoop === 'function') {
    canvasSnapshotLoop()
    return
  }
  if (canvasSnapshotLoop && canvasSnapshotLoop.stop) {
    canvasSnapshotLoop.stop()
  }
}

function resetCanvasSnapshots(canvasSnapshotLoop) {
  if (canvasSnapshotLoop && canvasSnapshotLoop.reset) {
    canvasSnapshotLoop.reset()
  }
}

function shouldKeepSessionAliveAfterAutoCanvasSnapshot(result) {
  return !!(
    result &&
    result.status === 'completed' &&
    result.selectedCanvasCount > 0 &&
    (result.results || []).some(function (entry) {
      return isKeepAliveWorthyAutoCanvasResult(entry)
    })
  )
}

function isKeepAliveWorthyAutoCanvasResult(entry) {
  return !!(
    entry &&
    (entry.ok ||
      entry.reason === 'unchanged' ||
      entry.reason === 'below_threshold')
  )
}

function cloneAutoCanvasSnapshotDebugResult(
  result,
  keepSessionAliveTriggered
) {
  if (!result) {
    return result
  }

  if (typeof keepSessionAliveTriggered === 'undefined') {
    keepSessionAliveTriggered = result.keepSessionAliveTriggered
  }

  return {
    scheduler: result.scheduler,
    status: result.status,
    startedAt:
      typeof result.startedAt === 'number' ? result.startedAt : result.timestamp,
    completedAt:
      typeof result.completedAt === 'number'
        ? result.completedAt
        : result.timestamp,
    timestamp: result.timestamp,
    eligibleCanvasCount: result.eligibleCanvasCount,
    selectedCanvasCount: result.selectedCanvasCount,
    skippedBudgetCount: result.skippedBudgetCount,
    keepSessionAliveTriggered: !!keepSessionAliveTriggered,
    results: (result.results || []).map(function (entry) {
      return {
        canvasId: entry.canvasId,
        ok: entry.ok,
        reason: entry.reason,
        priority: entry.priority
      }
    })
  }
}

function cloneCanvasMutationDebugResult(result) {
  if (!result) {
    return result
  }

  var clonedResult = {
    timestamp: result.timestamp,
    canvasId: result.canvasId,
    trigger: result.trigger,
    encodedBytesCount: result.encodedBytesCount,
    approxBytesCount: result.approxBytesCount,
    commandCount: result.commandCount,
    width: result.width,
    height: result.height
  }

  if (typeof result.reason !== 'undefined') {
    clonedResult.reason = result.reason
  }
  if (typeof result.diagnostics !== 'undefined') {
    clonedResult.diagnostics = result.diagnostics
  }

  return clonedResult
}

function createDomMutationDebugSummary(result) {
  if (!result) {
    return result
  }

  return {
    timestamp: timeStampNow(),
    adds: summarizeDomMutationEntries(result.adds, summarizeAddMutation),
    removes: summarizeDomMutationEntries(
      result.removes,
      summarizeRemoveMutation
    ),
    texts: summarizeDomMutationEntries(result.texts, summarizeTextMutation),
    attributes: summarizeDomMutationEntries(
      result.attributes,
      summarizeAttributeMutation
    ),
    addsCount: (result.adds || []).length,
    removesCount: (result.removes || []).length,
    textsCount: (result.texts || []).length,
    attributesCount: (result.attributes || []).length
  }
}

function summarizeDomMutationEntries(entries, summarizeEntry) {
  var summaries = []
  var entryCount = Math.min(
    (entries || []).length,
    DOM_MUTATION_DEBUG_SAMPLE_LIMIT
  )
  for (var index = 0; index < entryCount; index += 1) {
    summaries.push(summarizeEntry(entries[index]))
  }
  return summaries
}

function summarizeAddMutation(add) {
  var summary = {
    parentId: add.parentId,
    nextId: add.nextId
  }
  if (add.node) {
    summary.node = {
      id: add.node.id,
      type: add.node.type,
      tagName: add.node.tagName
    }
  }
  return summary
}

function summarizeRemoveMutation(remove) {
  return {
    parentId: remove.parentId,
    id: remove.id
  }
}

function summarizeTextMutation(textMutation) {
  return {
    id: textMutation.id,
    valueLength:
      typeof textMutation.value === 'string' ? textMutation.value.length : 0
  }
}

function summarizeAttributeMutation(attributeMutation) {
  var attributeNames = []
  var attributeNamesTruncated = false
  var attributes = attributeMutation.attributes || {}
  for (var attributeName in attributes) {
    if (!Object.prototype.hasOwnProperty.call(attributes, attributeName)) {
      continue
    }
    if (attributeNames.length >= DOM_MUTATION_DEBUG_SAMPLE_LIMIT) {
      attributeNamesTruncated = true
      break
    }
    attributeNames.push(attributeName)
  }
  return {
    id: attributeMutation.id,
    attributeNames: attributeNames,
    attributeNamesTruncated: attributeNamesTruncated
  }
}

function cloneDomMutationDebugResult(result) {
  if (!result) {
    return result
  }

  return {
    timestamp: result.timestamp,
    adds: result.adds.map(cloneDomMutationDebugEntry),
    removes: result.removes.map(cloneDomMutationDebugEntry),
    texts: result.texts.map(cloneDomMutationDebugEntry),
    attributes: result.attributes.map(cloneDomMutationDebugEntry),
    addsCount: result.addsCount,
    removesCount: result.removesCount,
    textsCount: result.textsCount,
    attributesCount: result.attributesCount
  }
}

function cloneDomMutationDebugEntry(entry) {
  var clonedEntry = assign({}, entry)
  if (entry.node) {
    clonedEntry.node = assign({}, entry.node)
  }
  if (entry.attributeNames) {
    clonedEntry.attributeNames = entry.attributeNames.slice()
  }
  return clonedEntry
}
