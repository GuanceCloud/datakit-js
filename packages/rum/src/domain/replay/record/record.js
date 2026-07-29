import {
  timeStampNow,
  getScrollX,
  getScrollY,
  assign,
  addTelemetryDebug,
  getParentNode
} from '@cloudcare/browser-core'
import { getViewportDimension } from '../../initViewportObservable'

import { RecordType, IncrementalSource } from '../../../types'
import { NodePrivacyLevel } from '../../../constants'
import {
  createMutationSerializerTask,
  SerializationContextStatus,
  getSerializedNodeApproxBytes,
  SERIALIZATION_MAX_NODE_COUNT,
  SERIALIZATION_MAX_APPROX_BYTES,
  SERIALIZATION_MAX_SYNC_DURATION_MS
} from './serialize'
import { initObservers } from './observers'

import { getVisualViewport } from './viewports'
import { assembleIncrementalSnapshot } from './utils'
import { createElementsScrollPositions } from './elementsScrollPositions'
import { initShadowRootsController } from './shadowRootsController'
import { createCanvasObserver } from './canvasObserver'
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
import { getNodePrivacyLevel } from './privacy'
import { startContinuousCanvasSnapshotLoop } from './canvasContinuousScheduler'
import { startCanvasWebGLSnapshotObserver } from './canvasWebGLSnapshotObserver'

var MUTATION_EMIT_DELAY_MS = 16
var MAX_MUTATION_EMIT_APPROX_BYTES = 200000
var MUTATION_ADMISSION_RETRY_DELAY_MS = 32
var MAX_PENDING_MUTATION_ADMISSION_PAYLOADS = 512
var MAX_PENDING_MUTATION_ADMISSION_APPROX_BYTES = 32 * 1024 * 1024
var DYNAMIC_SHADOW_ROOT_SERIALIZATION_MAX_NODE_COUNT = 5000
var DYNAMIC_SHADOW_ROOT_SERIALIZATION_MAX_APPROX_BYTES =
  MAX_MUTATION_EMIT_APPROX_BYTES - 1024
var FULL_SNAPSHOT_SERIALIZATION_SLICE_MS = 4
var FULL_SNAPSHOT_MAX_RESTART_COUNT = 3
var FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS = 1000
export var MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT = 64
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
    record.type === RecordType.IncrementalSnapshot &&
    record.data &&
    (record.data.source === IncrementalSource.CanvasMutation ||
      record.data.source === IncrementalSource.StyleSheetRule)
  )
}

export function record(options) {
  var rawEmit = options.emit
  var rawEmitBaseline = options.$rEmitBaseline
  // runtime checks for user options
  if (!rawEmit) {
    throw new Error('emit function is required')
  }
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
      shouldUseCommandCapture(options.configuration) ||
      shouldUseContinuousCanvasSnapshot(options.configuration)
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
  var deferredRecordAdmissionTimeout
  var lastEmitWasLocallyBackpressured = false
  var emit = function (record) {
    lastEmitWasLocallyBackpressured = false
    if (
      !suppressRecordsUntilFullSnapshot &&
      !deferredRecords.length &&
      deferredRecordAdmissionTimeout === undefined
    ) {
      return rawEmit(record) !== false
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
      deferredRecords.push({
        $rRecord: record,
        $rApproxBytes: recordApproxBytes
      })
      deferredRecordsApproxBytes += recordApproxBytes
      return true
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
    if (
      publicationToken &&
      typeof HTMLCanvasElement !== 'undefined' &&
      node instanceof HTMLCanvasElement
    ) {
      if (!publicationToken.$rCanvasNodes) {
        publicationToken.$rCanvasNodes = new Set()
      }
      publicationToken.$rCanvasNodes.add(node)
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
      if (!pendingPublicationToken.$rCanceled) {
        return false
      }
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
      options.configuration.defaultPrivacyLevel
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
      configuration: options.configuration,
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
      requestFullSnapshotAfterMutationDrop()
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

  var updateReplayPerformanceStats = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? function (delta) {
        accumulateReplayPerformanceStats(replayPerformanceStats, delta)
      }
    : undefined

  var mutationSourceFlushInProgress = false
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
        requestFullSnapshotAfterMutationDrop(true)
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
      requestFullSnapshotAfterMutationDrop()
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
    if (
      pendingMutationAdmissionTimeout ||
      !pendingMutationAdmissionQueue.length ||
      recordStopping ||
      recordStopped
    ) {
      return
    }
    pendingMutationAdmissionTimeout = setTimeout(function () {
      pendingMutationAdmissionTimeout = undefined
      drainPendingMutationAdmissions()
    }, MUTATION_ADMISSION_RETRY_DELAY_MS)
  }

  function discardPendingMutationAdmissions() {
    if (pendingMutationAdmissionTimeout) {
      clearTimeout(pendingMutationAdmissionTimeout)
      pendingMutationAdmissionTimeout = undefined
    }
    pendingMutationAdmissionQueue.forEach(function (entry) {
      discardMutationMembership(entry[0])
    })
    pendingMutationAdmissionQueue = []
    pendingMutationAdmissionApproxBytes = 0
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
        requestFullSnapshotAfterMutationDrop()
        return
      }
      entry[2] = assembleIncrementalSnapshot(
        IncrementalSource.Mutation,
        entry[0]
      )
      pendingMutationAdmissionQueue.push(entry)
      pendingMutationAdmissionApproxBytes += entry[1]
      if (!pendingMutationAdmissionTimeout) {
        var admissionResult = drainPendingMutationAdmissions()
        if (
          admissionResult === false ||
          suppressRecordsUntilFullSnapshot ||
          recordStopped
        ) {
          mutationEntries
            .slice(entryIndex + 1)
            .forEach(function (remainingEntry) {
              discardMutationMembership(remainingEntry[0])
            })
          return
        }
      }
    }
  }

  function drainPendingMutationAdmissions() {
    if (pendingMutationAdmissionTimeout) {
      clearTimeout(pendingMutationAdmissionTimeout)
      pendingMutationAdmissionTimeout = undefined
    }
    if (suppressRecordsUntilFullSnapshot) {
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
      if (
        emit(entry[2])
      ) {
        pendingMutationAdmissionQueue.shift()
        pendingMutationAdmissionApproxBytes -= entry[1]
        publishMutationMembership(mutationPayload)
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
      requestFullSnapshotAfterMutationDrop()
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
      requestFullSnapshotAfterMutationDrop()
    }
  }
  var inputCb = function (s) {
    emit(assembleIncrementalSnapshot(IncrementalSource.Input, s))
  }

  var shadowRootsController
  try {
    shadowRootsController = initShadowRootsController(options.configuration, {
      mutationCb,
      mutationOverflowCb: requestFullSnapshotAfterMutationDrop,
      mutationActivityCb: trackDomMutationActivity,
      inputCb,
      isNodeIgnored: isNodeIgnored,
      isNodePublished: isNodeQueuedOrPublished,
      mutationNodeSerializationCb: stageMutationNodePublication,
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
    options.configuration
  )
  var canvasObserver
  try {
    canvasObserver = (
      options.createCanvasObserver || createCanvasObserver
    )({
      configuration: options.configuration,
      emit: emit,
      isNodeActive: function (node) {
        return !isNodeIgnored(node)
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
  var startCanvasSnapshotLoop =
    options.startContinuousCanvasSnapshotLoop ||
    startContinuousCanvasSnapshotLoop
  var canvasSnapshotLoop
  try {
    canvasSnapshotLoop = shouldUseCanvasCommandCapture
      ? {
          stop: function () {},
          reset: function () {}
        }
      : startCanvasSnapshotLoop({
          configuration: options.configuration,
          getCanvases: function (maxScanCount) {
            return getActiveSerializedCanvases(maxScanCount)
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
    canvasCommandCapture = (
      options.startCanvasCommandCapture || startCanvasCommandCapture
    )({
      configuration: options.configuration,
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
      startPaused: true
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(canvasCommandCapture.stop)

  var canvasWebGLSnapshotObserver
  try {
    canvasWebGLSnapshotObserver = (
      options.startCanvasWebGLSnapshotObserver ||
      startCanvasWebGLSnapshotObserver
    )({
      configuration: options.configuration,
      snapshotCanvas: function (canvas, snapshotOptions) {
        return snapshotCanvasIfActive(canvas, snapshotOptions)
      },
      getSerializedNodeId: function (canvas) {
        return getActiveSerializedNodeId(canvas)
      },
      onDebug: handleAutoCanvasSnapshotDebug
    })
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  registerInitializationCleanup(canvasWebGLSnapshotObserver.stop)

  function snapshotCanvasIfActive(canvas, snapshotOptions) {
    if (isNodeIgnored(canvas)) {
      return Promise.resolve({
        ok: false,
        reason: 'not_serialized'
      })
    }
    var baselineToken =
      canvasCommandCapture &&
      canvasCommandCapture.createCanvasSnapshotBaselineToken
        ? canvasCommandCapture.createCanvasSnapshotBaselineToken(canvas)
        : undefined
    return Promise.resolve(
      canvasObserver.snapshot(canvas, snapshotOptions)
    ).then(function (result) {
      if (
        result &&
        result.ok === true &&
        canvasCommandCapture &&
        canvasCommandCapture.markCanvasSnapshotBaseline
      ) {
        canvasCommandCapture.markCanvasSnapshotBaseline(
          canvas,
          baselineToken,
          snapshotOptions && snapshotOptions.scheduler
        )
      }
      return result
    })
  }

  function createFullSnapshotSerializerTask(serializationContext) {
    var publicationToken = currentFullSnapshotPublicationToken
    return createMutationSerializerTask(document, {
      serializationContext: serializationContext,
      parentNodePrivacyLevel: options.configuration.defaultPrivacyLevel,
      configuration: options.configuration,
      onSerializedNode: function (node, parentNode) {
        stageFullSnapshotNodePublication(
          node,
          parentNode,
          publicationToken
        )
      }
    })
  }

  function emitFullSnapshot(timestamp, serializedDocument, startedAt) {
    var _viewportDimension = getViewportDimension()
    var width = _viewportDimension.width
    var height = _viewportDimension.height
    var baselineRecords = [
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
      addTelemetryDebug('Session Replay canvas baseline scan failed.', {
        error: String(error)
      })
    }
  }

  function takeFullSnapshotCanvasBaseline() {
    if (
      !options.configuration.replayCanvasEnabled ||
      options.configuration.replayCanvasMode !== 'auto'
    ) {
      scanExistingCommandCaptureCanvases()
      return
    }

    var baselineGeneration = fullSnapshotCanvasBaselineGeneration + 1
    fullSnapshotCanvasBaselineGeneration = baselineGeneration
    // The registry is already bounded and contains only canvases assigned an id
    // by the successful full snapshot.  Do not inspect or create a target
    // context here: a bitmap snapshot also covers contexts created before
    // replay started, including otherwise unknown WebGL canvases.
    var canvases
    try {
      canvases = filterActiveSerializedCanvases(
        getSerializedCanvasNodesSnapshot(
          MAX_FULL_SNAPSHOT_CANVAS_BASELINE_COUNT
        )
      )
    } catch (error) {
      addTelemetryDebug('Session Replay canvas baseline lookup failed.', {
        error: String(error)
      })
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
      var snapshotResult
      try {
        snapshotResult = snapshotCanvasIfActive(canvas, {
          trigger: 'auto',
          scheduler: 'full_snapshot_baseline'
        })
      } catch (_) {
        snapshotResult = undefined
      }
      return Promise.resolve(snapshotResult)
        .catch(function () {})
        .then(runNextCanvasBaseline)
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
    if (
      !serializerTask ||
      !serializerTask.advance(
        getPerformanceTime() + SERIALIZATION_MAX_SYNC_DURATION_MS,
        SERIALIZATION_MAX_NODE_COUNT,
        SERIALIZATION_MAX_APPROX_BYTES
      )
    ) {
      return false
    }
    return emitFullSnapshot(
      timestamp,
      serializerTask.serializedNode,
      fullSnapshotStartedAt
    )
  }

  var initialFullSnapshotSucceeded
  try {
    initialFullSnapshotSucceeded = takeInitialFullSnapshot()
  } catch (error) {
    return abortRecorderInitialization(
      'recorder_initialization_error',
      error
    )
  }
  if (initialFullSnapshotSucceeded) {
    takeFullSnapshotCanvasBaseline()
  } else {
    return abortRecorderInitialization(
      'initial_full_snapshot_serialization_budget'
    )
  }
  var _initObservers
  try {
    _initObservers = (options.initObservers || initObservers)({
      lifeCycle: options.lifeCycle,
      configuration: options.configuration,
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
      mutationPerfCb: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? updateReplayPerformanceStats
        : undefined,
      mutationOverflowCb: requestFullSnapshotAfterMutationDrop,
      mutationActivityCb: trackDomMutationActivity,
      mutationNodeSerializationCb: stageMutationNodePublication,
      isNodeIgnored: isNodeIgnored,
      isNodePublished: isNodeQueuedOrPublished,
      scrollCb: function (p) {
        emit(assembleIncrementalSnapshot(IncrementalSource.Scroll, p))
      },
      styleSheetCb: function (r) {
        if (
          !emit(
            assembleIncrementalSnapshot(
              IncrementalSource.StyleSheetRule,
              r
            )
          )
        ) {
          // CSSOM rules are index-addressed. Dropping one insert/delete makes
          // every later rule operation ambiguous, so replace the DOM/CSS
          // baseline instead of continuing a permanently divergent chain.
          requestFullSnapshotAfterMutationDrop()
        }
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
  function requestFullSnapshotAfterMutationDrop() {
    if (recordStopping || recordStopped) {
      return
    }
    // Any dropped mutation makes the live DOM diverge from the last uploaded
    // baseline, even when the missing record only contains text or attributes.
    // The replacement snapshot must therefore complete. If it cannot fit the
    // bounded serializer/segment budgets, stop and discard the held tail
    // instead of restoring a tree that is known to be stale.
    flushPendingMutations()
    scheduleSubsequentFullSnapshot(
      timeStampNow(),
      false,
      true
    )
  }
  function flushMutations() {
    mutationSourceFlushInProgress = true
    try {
      if (shadowRootsController.flush() === false) {
        // A shadow mutation that cannot be ordered after its unpublished host
        // invalidates the paired document add as well. This also applies to the
        // final page-exit drain, where starting a recovery snapshot is disabled.
        resetMutationsFromObservers()
        discardPendingMutationPayload()
        return false
      }
      // Drain the document observer in the same commit window as every
      // ShadowRoot observer. A move across those roots is reported as an add
      // by one observer and a remove by another, and neither half may become
      // visible to replay on its own.
      if (flushMutationsFromObservers() === false) {
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
    flushPendingMutations()
    return true
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

  function prepareForViewChange() {
    // A full snapshot supersedes mutation work that has not been emitted yet.
    // Do not force-drain time-sliced serializers immediately before traversing
    // the complete document.
    flushPendingMutations()
    discardPendingMutationAdmissions()
    resetMutationsFromObservers()
    if (shadowRootsController.reset) {
      shadowRootsController.reset()
    }
    discardPendingMutationPayload()
    resetPublishedReplayTree()
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
    prepareForViewChange()
    resetCanvasRecordingBaseline()
  }

  function cancelScheduledFullSnapshot() {
    if (pendingFullSnapshotTimeout !== undefined) {
      clearTimeout(pendingFullSnapshotTimeout)
      pendingFullSnapshotTimeout = undefined
    }
    pendingFullSnapshotTimestamp = undefined
    pendingFullSnapshotCanBeDiscarded = false
    pendingFullSnapshotRequiresTailDiscard = false
    pendingFullSnapshotTask = undefined
    pendingFullSnapshotMutationVersion = undefined
    pendingFullSnapshotStartedAt = undefined
    pendingFullSnapshotActiveDuration = 0
    pendingFullSnapshotRestartCount = 0
    pendingFullSnapshotRestartRequested = false
  }

  function clearDeferredRecords() {
    if (deferredRecordAdmissionTimeout !== undefined) {
      clearTimeout(deferredRecordAdmissionTimeout)
      deferredRecordAdmissionTimeout = undefined
    }
    deferredRecords = []
    deferredRecordsApproxBytes = 0
  }

  function handleDeferredRecordLoss(record) {
    if (!isStatefulDeferredRecord(record)) {
      return
    }
    if (pendingFullSnapshotTask) {
      requestFullSnapshotAfterMutationDrop()
      return
    }
    clearDeferredRecords()
    requestFullSnapshotAfterMutationDrop()
  }

  function scheduleDeferredRecordAdmissionRetry() {
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
      flushDeferredRecords()
    }, MUTATION_ADMISSION_RETRY_DELAY_MS)
  }

  function flushDeferredRecords() {
    if (
      suppressRecordsUntilFullSnapshot ||
      recordStopped
    ) {
      return
    }
    if (deferredRecordAdmissionTimeout !== undefined) {
      clearTimeout(deferredRecordAdmissionTimeout)
      deferredRecordAdmissionTimeout = undefined
    }
    while (deferredRecords.length) {
      var entry = deferredRecords[0]
      if (rawEmit(entry.$rRecord) !== false) {
        deferredRecords.shift()
        deferredRecordsApproxBytes -= entry.$rApproxBytes
        continue
      }
      if (
        options.$rWasLastEmitBackpressured &&
        options.$rWasLastEmitBackpressured()
      ) {
        scheduleDeferredRecordAdmissionRetry()
        return
      }
      deferredRecords.shift()
      deferredRecordsApproxBytes -= entry.$rApproxBytes
      if (isStatefulDeferredRecord(entry.$rRecord)) {
        // Canvas commands and CSSOM rule indexes form ordered state chains.
        // A permanent gap cannot be skipped; supersede the remainder with a
        // fresh mandatory baseline instead.
        clearDeferredRecords()
        requestFullSnapshotAfterMutationDrop()
        return
      }
    }
  }

  function restoreRecordingAfterAbandonedFullSnapshot() {
    restorePreviousPublishedReplayTree()
    if (shadowRootsController.$rRollbackRecovery) {
      shadowRootsController.$rRollbackRecovery()
    }
    suppressRecordsUntilFullSnapshot = false
    // Bitmap snapshots produced while the replacement baseline was being
    // serialized were deferred and are discarded on abandon. The shared
    // Canvas observer may already have advanced its frame signature/data URL
    // baseline, so reset every scheduler before rescanning; otherwise the
    // unchanged frame would never be emitted after recording resumes.
    resetCanvasRecordingBaseline()
    scanExistingCommandCaptureCanvases()
  }

  function beginSubsequentFullSnapshot(
    timestamp,
    canBeDiscarded,
    requiresTailDiscard
  ) {
    if (recordStopping || recordStopped) {
      return false
    }
    cancelScheduledFullSnapshot()
    pendingFullSnapshotTimestamp =
      typeof timestamp === 'undefined' ? timeStampNow() : timestamp
    pendingFullSnapshotCanBeDiscarded = Boolean(canBeDiscarded)
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
    suppressRecordsUntilFullSnapshot = true
    if (!previousPublishedReplayTree) {
      previousPublishedReplayTree = getPublishedReplayTree()
    }
    try {
      if (shadowRootsController.$rBeginRecovery) {
        shadowRootsController.$rBeginRecovery()
      }
      prepareForFullSnapshot()
      createPendingFullSnapshotTask()
    } catch (error) {
      handleFullSnapshotException(
        'full_snapshot_initialization_error',
        error
      )
      return false
    }
    return true
  }

  function createPendingFullSnapshotTask() {
    pendingFullSnapshotTask = createFullSnapshotSerializerTask({
      shadowRootsController: shadowRootsController,
      status: SerializationContextStatus.SUBSEQUENT_FULL_SNAPSHOT,
      elementsScrollPositions: elementsScrollPositions
    })
    pendingFullSnapshotMutationVersion = domMutationVersion
  }

  function schedulePendingFullSnapshotSlice() {
    if (
      recordStopped ||
      pendingFullSnapshotTimeout !== undefined ||
      !pendingFullSnapshotTask
    ) {
      return
    }
    pendingFullSnapshotTimeout = setTimeout(function () {
      pendingFullSnapshotTimeout = undefined
      runPendingFullSnapshotSliceSafely(true)
    }, 0)
  }

  function restartPendingFullSnapshot(allowScheduling) {
    pendingFullSnapshotRestartCount += 1
    pendingFullSnapshotRestartRequested = false
    if (
      pendingFullSnapshotRestartCount > FULL_SNAPSHOT_MAX_RESTART_COUNT ||
      pendingFullSnapshotActiveDuration > FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS
    ) {
      failOrAbandonFullSnapshot(
        'full_snapshot_changed_during_serialization'
      )
      return
    }
    // Records produced while serializing a discarded attempt may reference
    // nodes (including canvases) that are not part of the replacement
    // baseline. Never carry them across the generation boundary.
    clearDeferredRecords()
    prepareForViewChange()
    resetCanvasRecordingBaseline()
    createPendingFullSnapshotTask()
    if (allowScheduling) {
      schedulePendingFullSnapshotSlice()
    }
  }

  function runPendingFullSnapshotSlice(allowScheduling) {
    if (!pendingFullSnapshotTask || recordStopped) {
      return false
    }
    if (
      pendingFullSnapshotActiveDuration >
      FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS
    ) {
      failOrAbandonFullSnapshot('full_snapshot_serialization_timeout')
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
    var completed = pendingFullSnapshotTask.advance(
      sliceStartedAt + FULL_SNAPSHOT_SERIALIZATION_SLICE_MS,
      SERIALIZATION_MAX_NODE_COUNT,
      SERIALIZATION_MAX_APPROX_BYTES
    )
    pendingFullSnapshotActiveDuration += Math.max(
      getPerformanceTime() - sliceStartedAt,
      0
    )
    if (
      pendingFullSnapshotActiveDuration >
      FULL_SNAPSHOT_MAX_TOTAL_DURATION_MS
    ) {
      failOrAbandonFullSnapshot('full_snapshot_serialization_timeout')
      return false
    }
    if (
      pendingFullSnapshotTask.isMaxNodeCountReached ||
      pendingFullSnapshotTask.isMaxApproxBytesReached ||
      pendingFullSnapshotTask.isMaxDepthReached ||
      pendingFullSnapshotTask.isMaxNodeComplexityReached
    ) {
      failOrAbandonFullSnapshot('full_snapshot_serialization_watermark')
      return false
    }
    if (!completed) {
      if (allowScheduling) {
        schedulePendingFullSnapshotSlice()
      }
      return false
    }

    // Capture native records that have not reached their observer callback yet.
    // If any DOM changed during serialization, discard this mixed-time snapshot
    // and rebuild it from a clean mutation generation.
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

    var timestamp = pendingFullSnapshotTimestamp
    var serializedDocument = pendingFullSnapshotTask.serializedNode
    var startedAt = pendingFullSnapshotStartedAt
    if (!emitFullSnapshot(timestamp, serializedDocument, startedAt)) {
      failOrAbandonFullSnapshot('full_snapshot_admission_rejected')
      return false
    }
    cancelScheduledFullSnapshot()
    if (shadowRootsController.$rCommitRecovery) {
      shadowRootsController.$rCommitRecovery()
    }
    previousPublishedReplayTree = undefined
    suppressRecordsUntilFullSnapshot = false
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

  function runPendingFullSnapshotSliceSafely(allowScheduling) {
    try {
      return runPendingFullSnapshotSlice(allowScheduling)
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
    cancelScheduledFullSnapshot()
    clearDeferredRecords()
    if (skipRecoveryRestore) {
      // Teardown immediately retires every observer and Canvas scheduler.
      // Rebuilding up to 64 ShadowRoot observers and rescanning canvases here
      // would add pure main-thread work to stop() only to destroy it again.
      previousPublishedReplayTree = undefined
      suppressRecordsUntilFullSnapshot = false
    } else {
      restoreRecordingAfterAbandonedFullSnapshot()
    }
    if (
      shouldDiscardTail &&
      options.$rOnMandatoryFullSnapshotAbandoned
    ) {
      options.$rOnMandatoryFullSnapshotAbandoned()
    }
  }

  function failOrAbandonFullSnapshot(reason) {
    if (pendingFullSnapshotCanBeDiscarded) {
      abandonPendingFullSnapshot()
      return
    }
    failFullSnapshot(reason)
  }

  function failFullSnapshot(reason) {
    var shouldDiscardTail =
      pendingFullSnapshotRequiresTailDiscard
    cancelScheduledFullSnapshot()
    clearDeferredRecords()
    previousPublishedReplayTree = undefined
    if (
      shouldDiscardTail &&
      options.$rOnMandatoryFullSnapshotAbandoned
    ) {
      options.$rOnMandatoryFullSnapshotAbandoned()
    }
    stopRecording(undefined, true)
    if (options.onFullSnapshotFailure) {
      options.onFullSnapshotFailure(reason)
    }
  }

  function takeSubsequentFullSnapshot(timestamp) {
    if (beginSubsequentFullSnapshot(timestamp, false)) {
      runPendingFullSnapshotSliceSafely(true)
    }
  }

  function flushScheduledFullSnapshot(skipRecoveryRestore) {
    if (!pendingFullSnapshotTask) {
      return false
    }
    if (pendingFullSnapshotCanBeDiscarded) {
      abandonPendingFullSnapshot(skipRecoveryRestore)
      return true
    }
    clearTimeout(pendingFullSnapshotTimeout)
    pendingFullSnapshotTimeout = undefined
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
    if (pendingFullSnapshotTask) {
      // Any request arriving while a replacement baseline is being built must
      // reuse the same bounded transaction. Re-running begin() would reset its
      // restart/time budget and let sustained mutation churn spin forever.
      pendingFullSnapshotTimestamp =
        typeof timestamp === 'undefined' ? timeStampNow() : timestamp
      if (!canBeDiscarded) {
        pendingFullSnapshotCanBeDiscarded = false
      }
      if (
        requiresTailDiscard &&
        !pendingFullSnapshotRequiresTailDiscard
      ) {
        pendingFullSnapshotRequiresTailDiscard = true
        pendingFullSnapshotCanBeDiscarded = false
        if (options.$rOnMandatoryFullSnapshotStarted) {
          options.$rOnMandatoryFullSnapshotStarted()
        }
      }
      pendingFullSnapshotRestartRequested = true
      schedulePendingFullSnapshotSlice()
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
      if (!skipPendingFlush && !flushScheduledFullSnapshot(true)) {
        // Capture small records still queued by native MutationObservers.
        // Oversized subtree serialization is discarded once its synchronous
        // budget is exhausted.
        flushMutations()
      }
    } catch (error) {
      firstCleanupError = error
    }
    recordStopped = true
    ;[
      discardPendingMutationAdmissions,
      cancelScheduledFullSnapshot,
      invalidateFullSnapshotCanvasBaseline,
      function () {
        suppressRecordsUntilFullSnapshot = false
      },
      clearDeferredRecords,
      shadowRootsController.stop,
      canvasWebGLSnapshotObserver.stop,
      canvasCommandCapture.stop,
      canvasObserver.stop,
      function () {
        stopCanvasSnapshots(canvasSnapshotLoop)
      },
      stopObservers,
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
    snapshotCanvas: function (canvas, snapshotOptions) {
      return snapshotCanvasIfActive(
        canvas,
        assign({ trigger: 'manual' }, snapshotOptions)
      )
    },
    getSerializedNodeIdForDebug: function (node) {
      return getActiveSerializedNodeId(node)
    },
    getLastAutoCanvasSnapshotResultForDebug: function () {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        return cloneAutoCanvasSnapshotDebugResult(lastAutoCanvasSnapshotResult)
      }
    },
    getAutoCanvasSnapshotDebugHistoryForDebug: function () {
      return __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? autoCanvasSnapshotDebugHistoryForDebug.map(
            cloneAutoCanvasSnapshotDebugResult
          )
        : []
    },
    getLastCanvasMutationForDebug: function () {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        return cloneCanvasMutationDebugResult(lastCanvasMutationForDebug)
      }
    },
    getCanvasMutationHistoryForDebug: function () {
      return __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? canvasMutationHistoryForDebug.map(cloneCanvasMutationDebugResult)
        : []
    },
    getLastDomMutationForDebug: function () {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        return cloneDomMutationDebugResult(lastDomMutationForDebug)
      }
    },
    getDomMutationHistoryForDebug: function () {
      return __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? domMutationHistoryForDebug.map(cloneDomMutationDebugResult)
        : []
    },
    getReplayPerformanceForDebug: function () {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        return cloneReplayPerformanceStats(replayPerformanceStats)
      }
    },
    takeSubsequentFullSnapshot: takeSubsequentFullSnapshot,
    flushScheduledFullSnapshot: flushScheduledFullSnapshot,
    scheduleSubsequentFullSnapshot: scheduleSubsequentFullSnapshot,
    prepareForViewChange: prepareForViewChange,
    flushMutations: flushMutations,
    shadowRootsController: shadowRootsController
  }
  return recorder
}

function createInactiveRecorder() {
  var noop = function () {}
  return {
    stop: noop,
    snapshotCanvas: noop,
    getSerializedNodeIdForDebug: noop,
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
    getReplayPerformanceForDebug: noop,
    takeSubsequentFullSnapshot: noop,
    flushScheduledFullSnapshot: function () {
      return false
    },
    scheduleSubsequentFullSnapshot: noop,
    prepareForViewChange: noop,
    flushMutations: noop
  }
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
  wasNodePublishedBeforePendingMutation
) {
  return (
    hasRemoveToAddDependency(
      first.removes,
      second.adds,
      pendingPublicationTokenByNode,
      wasNodePublishedBeforePendingMutation
    ) ||
    hasRemoveToAddDependency(
      second.removes,
      first.adds,
      pendingPublicationTokenByNode,
      wasNodePublishedBeforePendingMutation
    )
  )
}

function hasRemoveToAddDependency(
  removes,
  adds,
  pendingPublicationTokenByNode,
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
  return removes.some(function (remove) {
    var removedNode = getMutationRemoveSourceNode(remove)
    return Boolean(
      removedNode &&
        wasNodePublishedBeforePendingMutation(removedNode) &&
        addPublicationTokens.has(
          pendingPublicationTokenByNode.get(removedNode)
        )
    )
  })
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
