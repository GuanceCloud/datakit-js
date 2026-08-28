import {
  ONE_SECOND,
  LifeCycleEventType,
  isPageExitReason,
  PageExitReason,
  assign,
  addTelemetryDebug,
  dateNow,
  setTimeout,
  clearTimeout
} from '@cloudcare/browser-core'
import { IncrementalSource, RecordType } from '../../../types'
import { buildReplayPayload } from './buildReplayPayload'
import { createSegment } from './segment'
import {
  isSessionReplayTimeAnchor,
  SESSION_REPLAY_TIME_ANCHOR_BACKPRESSURE_RESERVE
} from '../timeAnchor'

export var SEGMENT_DURATION_LIMIT = 5 * ONE_SECOND
/**
 * beacon payload max queue size implementation is 64kb
 * ensure that we leave room for logs, rum and potential other users
 */
export var SEGMENT_BYTES_LIMIT = 60000
// buildReplayPayload() exposes the compressed segment size, but sendBeacon
// accounts for the multipart boundaries, headers, and metadata fields too.
// Reserve a conservative envelope per segment so several small unload
// segments cannot collectively overrun the browser's exit delivery queue.
var SEGMENT_FORM_DATA_ESTIMATED_OVERHEAD = 2 * 1024
var SEGMENT_PENDING_RAW_BYTES_LIMIT = 4 * 1024 * 1024
var LOCKED_SEGMENTS_LIMIT = 12
var CANVAS_FLUSH_MIN_INTERVAL = 250
var MAX_CONSECUTIVE_FULL_SNAPSHOT_FAILURES = 3

// Segments are the main data structure for session replays. They contain context information used
// for indexing or UI needs, and a list of records (RRWeb 'events', renamed to avoid confusing
// namings). They are stored without any processing from the intake, and fetched one after the
// other while a session is being replayed. Their encoding (deflate) are carefully crafted to allow
// concatenating multiple segments together. Segments have a size overhead (metadata), so our goal is to
// build segments containing as many records as possible while complying with the various flush
// strategies to guarantee a good replay quality.
//
// When the recording starts, a segment is initially created.  The segment is flushed (finalized and
// sent) based on various events (non-exhaustive list):
//
// * the page visibility change or becomes to unload
// * the segment duration reaches a limit
// * the encoded segment bytes count reaches a limit
// * ...
//
// A segment cannot be created without its context.  If the RUM session ends and no session id is
// available when creating a new segment, records will be ignored, until the session is renewed and
// a new session id is available.
//
// Empty segments (segments with no record) aren't useful and should be ignored.
//
// To help investigate session replays issues, each segment is created with a "creation reason",
// indicating why the session has been created.

export function startSegmentCollection(
  lifeCycle,
  configuration,
  sessionManager,
  viewContexts,
  httpRequest,
  encoder,
  isLocked = false,
  additionalOptions
) {
  return doStartSegmentCollection(
    lifeCycle,
    function () {
      return computeSegmentContext(configuration, sessionManager, viewContexts)
    },
    httpRequest,
    encoder,
    isLocked,
    assign(
      {
        flushCanvasImmediately: configuration.replayCanvasFlushImmediately,
        pendingRawBytesLimit: SEGMENT_PENDING_RAW_BYTES_LIMIT,
        beforePageExitFlush: undefined,
        onReplayResetNeeded: undefined,
        onReplayResetExhausted: undefined,
        onSegmentFlushed: undefined
      },
      additionalOptions
    )
  )
}

var SegmentCollectionStatus = {
  WaitingForInitialRecord: 0,
  SegmentPending: 1,
  Stopped: 2
}

export function doStartSegmentCollection(
  lifeCycle,
  getSegmentContext,
  httpRequest,
  encoder,
  isLocked,
  options
) {
  if (options === undefined) {
    options = {}
  }
  var pendingRawBytesLimit =
    typeof options.pendingRawBytesLimit === 'number'
      ? options.pendingRawBytesLimit
      : SEGMENT_PENDING_RAW_BYTES_LIMIT
  var lockedSegments = []
  var lockedBufferGeneration = 0
  var reportedDropReasons = {}
  var lastCanvasFlushAt = -Infinity
  var canvasFlushTimeoutId
  var replayResetNeeded = false
  var replayResetReason
  var replayResetNotificationSent = false
  var replayResetNotificationTimeoutId
  var activeBaselineGeneration = 0
  var nextBaselineGeneration = 0
  var baselineGenerationStates = {}
  var transportGenerationStates = {}
  var baselineGenerationInFlightCounts = {}
  var pendingSegmentResultsByGeneration = {}
  var consecutiveFullSnapshotFailures = 0
  var replayRecoveryExhausted = false
  var lifecycleSubscriptionsStopped = false
  var nextSegmentFlushSequence = 0
  var inFlightSegmentFlushes = new Set()
  var lastAddRecordWasBackpressured = false
  var backpressuredSerializedRecordData = new WeakMap()
  var unloadingTransportLatched = false
  var unloadingDeliveryBytesRemaining
  var unloadingDeliveryBudgetExhausted = false
  var unloadingRetryPayloadsDrained = false
  var mandatoryRecoveryPending = false
  var bufferCheckoutPending = false
  var activeBaselineTransaction
  var state = {
    $rStatus: SegmentCollectionStatus.WaitingForInitialRecord,
    $rNextReason: 'init',
    $rLocked: isLocked,
    $rGeneration: activeBaselineGeneration
  }
  function prepareRecordsBeforePageExit(pageExitEvent) {
    if (!options.beforePageExitFlush) {
      return
    }
    try {
      return options.beforePageExitFlush(pageExitEvent)
    } catch (error) {
      addTelemetryDebug(
        'Session Replay failed to prepare records before page exit.',
        {
          reason: pageExitEvent && pageExitEvent.reason,
          error: String(error)
        }
      )
    }
  }
  var subscribeViewCreated = lifeCycle.subscribe(
    LifeCycleEventType.VIEW_CREATED,
    function () {
      flushSegment('view_change')
    }
  )
  var unsubscribeViewCreated = subscribeViewCreated.unsubscribe
  var subscribePageExited = lifeCycle.subscribe(
    LifeCycleEventType.PAGE_EXITED,
    function (pageExitEvent) {
      if (state.$rStatus === SegmentCollectionStatus.Stopped) {
        return
      }
      prepareRecordsBeforePageExit(pageExitEvent)
      upgradeSegmentTransportsForPageExit(pageExitEvent.reason)
      if (
        state.$rLocked &&
        pageExitEvent.reason === PageExitReason.UNLOADING
      ) {
        lockedBufferGeneration += 1
        lockedSegments = []
      }
      flushSegment(pageExitEvent.reason)
      if (flushPendingSegmentEncodingsForUnload(pageExitEvent.reason)) {
        // The synchronous drain releases encoder backpressure. Give staged DOM
        // mutations one final admission pass, then flush that second segment
        // through the same unload-safe transport.
        prepareRecordsBeforePageExit(pageExitEvent)
        flushSegment(pageExitEvent.reason)
        flushPendingSegmentEncodingsForUnload(pageExitEvent.reason)
      }
    }
  )
  var unsubscribePageExited = subscribePageExited.unsubscribe

  function reportDroppedRecord(reason, estimatedBytesCount) {
    if (reportedDropReasons[reason]) {
      return
    }
    reportedDropReasons[reason] = true
    addTelemetryDebug('Session Replay record discarded.', {
      reason: reason,
      estimated_bytes_count: estimatedBytesCount
    })
  }

  function clearReplayResetNotificationTimeout() {
    if (replayResetNotificationTimeoutId !== undefined) {
      clearTimeout(replayResetNotificationTimeoutId)
      replayResetNotificationTimeoutId = undefined
    }
  }

  function getPendingRawBytesCount() {
    return encoder.getPendingRawBytesCount
      ? encoder.getPendingRawBytesCount()
      : 0
  }

  function scheduleReplayResetNotification() {
    if (
      !replayResetNeeded ||
      replayResetNotificationSent ||
      replayResetNotificationTimeoutId !== undefined ||
      !options.onReplayResetNeeded ||
      state.$rStatus === SegmentCollectionStatus.Stopped ||
      getPendingRawBytesCount() > 0
    ) {
      return
    }

    replayResetNotificationTimeoutId = setTimeout(function () {
      replayResetNotificationTimeoutId = undefined
      if (
        !replayResetNeeded ||
        replayResetNotificationSent ||
        state.$rStatus === SegmentCollectionStatus.Stopped ||
        getPendingRawBytesCount() > 0
      ) {
        return
      }
      replayResetNotificationSent = true
      options.onReplayResetNeeded(replayResetReason)
    }, 0)
  }

  function markReplayResetNeeded(reason, shouldNotifyAgain) {
    if (!replayResetNeeded || shouldNotifyAgain) {
      replayResetReason = reason
      replayResetNotificationSent = false
      if (shouldNotifyAgain) {
        clearReplayResetNotificationTimeout()
      }
    }
    replayResetNeeded = true
    scheduleReplayResetNotification()
  }

  function clearReplayResetNeeded() {
    replayResetNeeded = false
    replayResetReason = undefined
    replayResetNotificationSent = false
    clearReplayResetNotificationTimeout()
  }

  function unsubscribeLifecycle() {
    if (lifecycleSubscriptionsStopped) {
      return
    }
    lifecycleSubscriptionsStopped = true
    unsubscribeViewCreated()
    unsubscribePageExited()
  }

  function exhaustReplayRecovery(reason) {
    if (replayRecoveryExhausted) {
      return
    }
    replayRecoveryExhausted = true
    clearReplayResetNeeded()
    clearCanvasFlushTimeout()
    lockedBufferGeneration += 1
    lockedSegments = []
    baselineGenerationStates = {}
    transportGenerationStates = {}
    baselineGenerationInFlightCounts = {}
    pendingSegmentResultsByGeneration = {}
    if (state.$rStatus === SegmentCollectionStatus.SegmentPending) {
      // A dependent segment can already exist when the asynchronous failure
      // of the third replacement baseline arrives. Finalize-discard its
      // shared deflate stream before stopping, otherwise a later explicit
      // recorder restart can prepend these abandoned bytes to the new
      // baseline.
      discardCurrentSegment('recovery_exhausted')
    }
    state = {
      $rStatus: SegmentCollectionStatus.Stopped,
      $rLocked: false
    }
    unsubscribeLifecycle()
    if (options.onReplayResetExhausted) {
      options.onReplayResetExhausted(reason)
    }
  }

  function failBaselineGeneration(
    baselineGeneration,
    reason,
    isFullSnapshotFailure
  ) {
    if (baselineGeneration > 0) {
      baselineGenerationStates[baselineGeneration] = 'invalid'
      delete pendingSegmentResultsByGeneration[baselineGeneration]
    }
    if (baselineGeneration !== activeBaselineGeneration) {
      tryCleanupBaselineGeneration(baselineGeneration)
      return
    }

    if (isFullSnapshotFailure) {
      consecutiveFullSnapshotFailures += 1
      if (
        consecutiveFullSnapshotFailures >=
        MAX_CONSECUTIVE_FULL_SNAPSHOT_FAILURES
      ) {
        exhaustReplayRecovery(reason)
        return
      }
    }
    markReplayResetNeeded(reason, true)
  }

  function retainBaselineGeneration(baselineGeneration) {
    if (baselineGeneration <= 0) {
      return
    }
    baselineGenerationInFlightCounts[baselineGeneration] =
      (baselineGenerationInFlightCounts[baselineGeneration] || 0) + 1
  }

  function releaseBaselineGeneration(baselineGeneration) {
    if (
      baselineGeneration <= 0 ||
      !baselineGenerationInFlightCounts[baselineGeneration]
    ) {
      return
    }
    baselineGenerationInFlightCounts[baselineGeneration] -= 1
    if (!baselineGenerationInFlightCounts[baselineGeneration]) {
      delete baselineGenerationInFlightCounts[baselineGeneration]
    }
    tryCleanupBaselineGeneration(baselineGeneration)
  }

  function tryCleanupBaselineGeneration(baselineGeneration) {
    if (
      baselineGeneration <= 0 ||
      baselineGeneration === activeBaselineGeneration ||
      baselineGenerationInFlightCounts[baselineGeneration] ||
      pendingSegmentResultsByGeneration[baselineGeneration]
    ) {
      return
    }
    delete baselineGenerationStates[baselineGeneration]
    delete transportGenerationStates[baselineGeneration]
  }

  function getTransportGenerationState(baselineGeneration) {
    if (!transportGenerationStates[baselineGeneration]) {
      transportGenerationStates[baselineGeneration] = { $rValid: true }
    }
    return transportGenerationStates[baselineGeneration]
  }

  function clearCanvasFlushTimeout() {
    if (canvasFlushTimeoutId !== undefined) {
      clearTimeout(canvasFlushTimeoutId)
      canvasFlushTimeoutId = undefined
    }
  }

  function upgradeSegmentTransportsForPageExit(flushReason) {
    if (!isPageExitReason(flushReason)) {
      return
    }
    if (flushReason === PageExitReason.UNLOADING) {
      unloadingTransportLatched = true
      if (unloadingDeliveryBytesRemaining === undefined) {
        unloadingDeliveryBytesRemaining = SEGMENT_BYTES_LIMIT
      }
      drainRetryPayloadsForUnload()
    }
    inFlightSegmentFlushes.forEach(function (transport) {
      transport.$rExit = true
    })
    // A dependent segment can finish encoding before its Full Snapshot and is
    // then removed from inFlightSegmentFlushes while waiting for the baseline
    // generation to be confirmed. Preserve the page-exit transport intent on
    // those completed results as well. UNLOADING still uses the shared latch
    // and aggregate delivery budget in sendSegment().
    Object.keys(pendingSegmentResultsByGeneration).forEach(function (
      baselineGeneration
    ) {
      pendingSegmentResultsByGeneration[baselineGeneration].forEach(function (
        segmentResult
      ) {
        segmentResult.$rExit = true
      })
    })
  }

  function flushPendingSegmentEncodingsSync() {
    if (encoder.flushPendingActionsSync) {
      encoder.flushPendingActionsSync(SEGMENT_BYTES_LIMIT)
      return true
    }
    return false
  }

  function drainRetryPayloadsForUnload() {
    if (unloadingRetryPayloadsDrained) {
      return
    }
    unloadingRetryPayloadsDrained = true
    if (typeof httpRequest.$rDrainOnExit !== 'function') {
      return
    }

    var deliveryResult = httpRequest.$rDrainOnExit(
      unloadingDeliveryBytesRemaining
    )
    if (
      deliveryResult &&
      typeof deliveryResult.$rBytesCount === 'number' &&
      isFinite(deliveryResult.$rBytesCount) &&
      deliveryResult.$rBytesCount >= 0
    ) {
      unloadingDeliveryBytesRemaining = Math.max(
        unloadingDeliveryBytesRemaining - deliveryResult.$rBytesCount,
        0
      )
      if (deliveryResult.$rAllPayloadsSent === false) {
        // Replay segments are ordered. If an older queued payload does not fit,
        // no current tail may overtake it.
        unloadingDeliveryBudgetExhausted = true
      }
    }
  }

  function flushPendingSegmentEncodingsForUnload(flushReason) {
    return (
      flushReason === PageExitReason.UNLOADING &&
      flushPendingSegmentEncodingsSync()
    )
  }

  function removeInFlightSegmentFlush(transport) {
    inFlightSegmentFlushes.delete(transport)
  }

  function handlePermanentTransportDrop(segmentResult, reason) {
    // Invalidate the transport chain even after the recorder itself stopped;
    // older queued dependents must never be promoted past the missing segment.
    segmentResult.$rTransportGeneration.$rValid = false
    if (
      state.$rStatus === SegmentCollectionStatus.Stopped ||
      replayRecoveryExhausted
    ) {
      return
    }
    var dropReason = 'transport_' + reason
    reportDroppedRecord(dropReason, 0)
    // Once a segment is permanently rejected, every later incremental in its
    // generation may depend on replay state the player will never receive.
    // Retire the generation and gate admission until a replacement Full
    // Snapshot establishes a new chain. A transport failure is not evidence
    // that Full Snapshot serialization itself is permanently broken.
    failBaselineGeneration(segmentResult.$rGeneration, dropReason, false)
    scheduleReplayResetNotification()
  }

  function sendSegment(segmentResult) {
    const metadata = segmentResult.$rMetadata
    const encoderResult = segmentResult.$rEncoder
    if (
      __BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
      options.onSegmentFlushed
    ) {
      options.onSegmentFlushed({
        creationReason: metadata.creation_reason,
        flushReason: segmentResult.$rReason,
        recordsCount: metadata.records_count,
        recordCountsByType: segmentResult.$rCounts,
        start: metadata.start,
        end: metadata.end,
        indexInView: metadata.index_in_view,
        rawBytesCount: encoderResult.rawBytesCount
      })
    }
    var shouldUseExitTransport =
      !segmentResult.$rRegular &&
      (segmentResult.$rExit ||
        isPageExitReason(segmentResult.$rReason) ||
        unloadingTransportLatched)
    var estimatedDeliveryBytesCount =
      encoderResult.outputBytesCount +
      SEGMENT_FORM_DATA_ESTIMATED_OVERHEAD
    if (shouldUseExitTransport && unloadingTransportLatched) {
      if (
        unloadingDeliveryBudgetExhausted ||
        estimatedDeliveryBytesCount > unloadingDeliveryBytesRemaining
      ) {
        unloadingDeliveryBudgetExhausted = true
        reportDroppedRecord(
          'page_exit_delivery_budget',
          estimatedDeliveryBytesCount
        )
        return
      }
    }

    var payload = buildReplayPayload(
      encoderResult.output,
      metadata,
      encoderResult.rawBytesCount
    )
    payload.$rExitBytesCount = estimatedDeliveryBytesCount
    payload.$rEnforceOrder = true
    payload.$rIsValid = function () {
      return segmentResult.$rTransportGeneration.$rValid
    }
    payload.$rOnPermanentDrop = function (reason) {
      handlePermanentTransportDrop(segmentResult, reason)
    }

    if (shouldUseExitTransport) {
      var exitDeliveryResult = httpRequest.sendOnExit(
        payload,
        unloadingTransportLatched
          ? unloadingDeliveryBytesRemaining
          : undefined
      )
      if (unloadingTransportLatched) {
        if (
          exitDeliveryResult &&
          typeof exitDeliveryResult.$rBytesCount === 'number' &&
          isFinite(exitDeliveryResult.$rBytesCount) &&
          exitDeliveryResult.$rBytesCount >= 0
        ) {
          unloadingDeliveryBytesRemaining = Math.max(
            unloadingDeliveryBytesRemaining -
              exitDeliveryResult.$rBytesCount,
            0
          )
          if (!exitDeliveryResult.$rCurrentPayloadSent) {
            unloadingDeliveryBudgetExhausted = true
            reportDroppedRecord(
              'page_exit_delivery_budget',
              estimatedDeliveryBytesCount
            )
          }
        } else {
          // Preserve compatibility with injected transports that predate the
          // aggregate-budget result contract.
          unloadingDeliveryBytesRemaining -= estimatedDeliveryBytesCount
        }
      }
    } else {
      httpRequest.send(payload)
    }
  }

  function retainLockedSegment(segmentResult) {
    // A hidden-page beacon intent is only relevant while the page is hidden.
    // If an error-session buffer is later unlocked, drain it through the
    // regular transport instead of retaining a stale sendOnExit decision.
    segmentResult.$rExit = false
    segmentResult.$rRegular = true
    if (replayResetNeeded) {
      // A valid replacement snapshot clears the reset before delivery.
      return
    }
    lockedSegments.push(segmentResult)

    var latestFullSnapshotIndex = -1
    for (var index = lockedSegments.length - 1; index >= 0; index -= 1) {
      if (lockedSegments[index].$rMetadata.has_full_snapshot) {
        latestFullSnapshotIndex = index
        break
      }
    }

    if (latestFullSnapshotIndex > 0) {
      lockedSegments.splice(0, latestFullSnapshotIndex)
    }

    if (lockedSegments.length > LOCKED_SEGMENTS_LIMIT) {
      // Incremental segments form a dependency chain. Keeping the anchor while
      // deleting a middle segment can leave later records referencing nodes the
      // player never received. Retire the whole lock generation and admit no
      // more incrementals until a replacement full snapshot starts a new chain.
      lockedBufferGeneration += 1
      lockedSegments = []
      markReplayResetNeeded('locked_buffer_capacity')
      // Records already admitted to the current segment still belong to the
      // overflowing lock epoch. Finalize that segment now so its immutable
      // epoch can reject the result, and force the replacement Full Snapshot
      // to start a clean segment.
      flushSegment('locked_buffer_capacity')
    }
  }

  function drainLockedSegments() {
    const segmentsToSend = lockedSegments
    lockedSegments = []
    if (
      segmentsToSend.length > 0 &&
      !segmentsToSend.some(function (segmentResult) {
        return segmentResult.$rMetadata.has_full_snapshot
      })
    ) {
      markReplayResetNeeded('locked_buffer_missing_full_snapshot')
      return
    }
    segmentsToSend.forEach(function (segmentResult) {
      segmentResult.$rExit = false
      segmentResult.$rRegular = true
      sendSegment(segmentResult)
    })
  }

  function deliverSegmentResult(segmentResult) {
    if (!segmentResult.$rLocked) {
      sendSegment(segmentResult)
      return
    }
    if (
      segmentResult.$rLockGeneration !== lockedBufferGeneration ||
      segmentResult.$rReason === 'buffer_checkout' ||
      segmentResult.$rReason === 'stop' ||
      segmentResult.$rReason === PageExitReason.UNLOADING
    ) {
      return
    }
    if (state.$rLocked) {
      retainLockedSegment(segmentResult)
    } else {
      segmentResult.$rExit = false
      segmentResult.$rRegular = true
      sendSegment(segmentResult)
    }
  }

  function retainPendingSegmentResult(baselineGeneration, segmentResult) {
    if (!pendingSegmentResultsByGeneration[baselineGeneration]) {
      pendingSegmentResultsByGeneration[baselineGeneration] = []
    }
    pendingSegmentResultsByGeneration[baselineGeneration].push(segmentResult)
  }

  function confirmBaselineGeneration(baselineGeneration, segmentResult) {
    if (
      replayRecoveryExhausted ||
      baselineGenerationStates[baselineGeneration] === 'invalid'
    ) {
      return
    }
    baselineGenerationStates[baselineGeneration] = 'confirmed'
    if (
      baselineGeneration === activeBaselineGeneration &&
      (!replayResetNeeded ||
        !segmentResult.$rLocked ||
        segmentResult.$rLockGeneration === lockedBufferGeneration)
    ) {
      consecutiveFullSnapshotFailures = 0
      clearReplayResetNeeded()
    }

    deliverSegmentResult(segmentResult)
    var pendingSegmentResults =
      pendingSegmentResultsByGeneration[baselineGeneration] || []
    delete pendingSegmentResultsByGeneration[baselineGeneration]
    pendingSegmentResults.sort(function (first, second) {
      return first.$rSequence - second.$rSequence
    })
    pendingSegmentResults.forEach(deliverSegmentResult)
    tryCleanupBaselineGeneration(baselineGeneration)
  }

  function handleSuccessfulSegment(baselineGeneration, segmentResult) {
    if (segmentResult.$rMetadata.has_full_snapshot) {
      confirmBaselineGeneration(baselineGeneration, segmentResult)
      return
    }
    if (baselineGeneration === 0) {
      deliverSegmentResult(segmentResult)
      return
    }

    var baselineState = baselineGenerationStates[baselineGeneration]
    if (baselineState === 'confirmed') {
      deliverSegmentResult(segmentResult)
    } else if (baselineState === 'pending') {
      retainPendingSegmentResult(baselineGeneration, segmentResult)
    } else if (
      baselineGeneration === activeBaselineGeneration &&
      !replayRecoveryExhausted
    ) {
      failBaselineGeneration(
        baselineGeneration,
        'missing_full_snapshot',
        false
      )
    }
  }

  function resetState(flushReason) {
    if (flushReason !== 'stop') {
      state = {
        $rStatus: SegmentCollectionStatus.WaitingForInitialRecord,
        $rNextReason: flushReason,
        $rLocked: state.$rLocked,
        $rGeneration: activeBaselineGeneration
      }
    } else {
      state = {
        $rStatus: SegmentCollectionStatus.Stopped,
        $rLocked: false
      }
    }
  }

  function handleFlushedSegment(
    flushReason,
    wasLocked,
    lockedGeneration,
    baselineGeneration,
    metadata,
    encoderResult,
    recordCountsByType,
    transport
  ) {
    if (replayRecoveryExhausted) {
      return
    }
    if (encoderResult.error) {
      reportDroppedRecord('encoder_error', 0)
      failBaselineGeneration(
        baselineGeneration,
        'encoder_error',
        metadata.has_full_snapshot
      )
      scheduleReplayResetNotification()
      return
    }
    // SEGMENT_BYTES_LIMIT is a rolling target and a beacon budget, not a hard
    // limit for regular fetch requests. The asynchronous deflate result can
    // legitimately overshoot its estimate. Discarding that finalized segment
    // would invalidate the replay chain and can force an impossible
    // replacement snapshot on large pages. sendSegment() applies the bounded
    // page-exit delivery budget separately.
    const segmentResult = {
      $rMetadata: metadata,
      $rEncoder: encoderResult,
      $rReason: flushReason,
      $rExit: transport.$rExit,
      $rLocked: wasLocked,
      $rLockGeneration: lockedGeneration,
      $rGeneration: baselineGeneration,
      $rTransportGeneration: getTransportGenerationState(
        baselineGeneration
      ),
      $rSequence: transport.$rSequence
    }
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      segmentResult.$rCounts = recordCountsByType
    }
    handleSuccessfulSegment(baselineGeneration, segmentResult)
    scheduleReplayResetNotification()
  }

  function flushSegment(flushReason, callback, isStopping) {
    if (state.$rStatus === SegmentCollectionStatus.Stopped) {
      if (callback) {
        callback()
      }
      return
    }
    if (
      state.$rStatus === SegmentCollectionStatus.SegmentPending &&
      state.$rMandatoryRecoveryHold
    ) {
      if (isStopping) {
        mandatoryRecoveryPending = false
        discardCurrentSegment('mandatory_recovery_incomplete')
        // discardCurrentSegment() normally returns to Waiting so a recovery
        // baseline can create the next stream. A terminal stop must override
        // that reusable state even though the discard finish is asynchronous.
        resetState('stop')
      }
      if (callback) {
        callback()
      }
      return
    }
    if (flushReason !== 'canvas_snapshot') {
      clearCanvasFlushTimeout()
    }
    if (state.$rStatus === SegmentCollectionStatus.SegmentPending) {
      const segmentState = state
      const wasLocked = segmentState.$rLocked
      const lockedGeneration = segmentState.$rLockGeneration
      const baselineGeneration = state.$rGeneration
      const transport = {
        $rExit: isPageExitReason(flushReason),
        $rSequence: ++nextSegmentFlushSequence
      }
      clearTimeout(state.$rExpiration)
      resetState(isStopping ? 'stop' : flushReason)
      if (!segmentState.$rSegment.isEmpty()) {
        inFlightSegmentFlushes.add(transport)
        retainBaselineGeneration(baselineGeneration)
        segmentState.$rSegment.flush(function (
          metadata,
          encoderResult,
          recordCountsByType
        ) {
          removeInFlightSegmentFlush(transport)
          try {
            handleFlushedSegment(
              flushReason,
              wasLocked,
              lockedGeneration,
              baselineGeneration,
              metadata,
              encoderResult,
              recordCountsByType,
              transport
            )
          } finally {
            releaseBaselineGeneration(baselineGeneration)
          }
          if (callback) {
            callback()
          }
        })
        return
      }
    }
    resetState(isStopping ? 'stop' : flushReason)
    if (callback) {
      callback()
    }
  }

  function ensureSegment() {
    if (state.$rStatus !== SegmentCollectionStatus.WaitingForInitialRecord) {
      return state.$rStatus === SegmentCollectionStatus.SegmentPending
    }
    var context = getSegmentContext()
    if (!context) {
      return false
    }

    state = {
      $rStatus: SegmentCollectionStatus.SegmentPending,
      $rSegment: createSegment({
        encoder: encoder,
        context: context,
        creationReason: state.$rNextReason
      }),
      $rLocked: state.$rLocked,
      $rLockGeneration: lockedBufferGeneration,
      $rGeneration: activeBaselineGeneration,
      $rHasSnapshot: false,
      $rMandatoryRecoveryHold: mandatoryRecoveryPending,
      $rExpiration: setTimeout(function () {
        flushSegment('segment_duration_limit')
      }, SEGMENT_DURATION_LIMIT)
    }
    return true
  }

  function discardEmptyCurrentSegment(reason) {
    if (
      state.$rStatus === SegmentCollectionStatus.SegmentPending &&
      state.$rSegment.isEmpty()
    ) {
      clearTimeout(state.$rExpiration)
      resetState(reason)
    }
  }

  function discardCurrentSegment(reason) {
    if (state.$rStatus !== SegmentCollectionStatus.SegmentPending) {
      return
    }
    var discardedSegment = state.$rSegment
    var isEmpty = discardedSegment.isEmpty()
    clearTimeout(state.$rExpiration)
    resetState(reason)
    if (!isEmpty) {
      // The deflate encoder is shared by consecutive segments. Merely
      // forgetting this Segment would leave its already-written bytes in the
      // active stream and prepend them to the replacement baseline. Finalize
      // the stream to reset the encoder, but deliberately ignore its result.
      discardedSegment.$rDiscard(function () {
        // A rejected mandatory Full Snapshot may have marked recovery while
        // encoder writes were still pending. Wake the deferred notification
        // after finish drains that backlog, even though this segment result is
        // intentionally not delivered.
        scheduleReplayResetNotification()
      })
    }
  }

  function addRecordToCurrentSegment(
    record,
    serializedRecordData,
    ignoreSegmentBytesLimit
  ) {
    const segmentState = state
    const segment = segmentState.$rSegment
    var synchronousEncoderError
    var isTimeAnchor = isSessionReplayTimeAnchor(record)
    var recordPendingRawBytesLimit = pendingRawBytesLimit
    if (isTimeAnchor && recordPendingRawBytesLimit !== undefined) {
      recordPendingRawBytesLimit +=
        SESSION_REPLAY_TIME_ANCHOR_BACKPRESSURE_RESERVE
    }
    var addResult = segment.addRecord(
      record,
      function (encodedBytesCount, error) {
        if (
          state.$rStatus !== SegmentCollectionStatus.SegmentPending ||
          state.$rSegment !== segment
        ) {
          scheduleReplayResetNotification()
          return
        }
        if (error) {
          synchronousEncoderError = error
          var isBaselineTransactionFailure =
            activeBaselineTransaction &&
            activeBaselineTransaction.$rSegment === segment
          clearTimeout(state.$rExpiration)
          reportDroppedRecord('encoder_error', 0)
          resetState('encoder_error')
          failBaselineGeneration(
            segmentState.$rGeneration,
            'encoder_error',
            segmentState.$rHasSnapshot ||
              Boolean(isBaselineTransactionFailure)
          )
        } else if (
          encodedBytesCount > SEGMENT_BYTES_LIMIT &&
          !segmentState.$rMandatoryRecoveryHold
        ) {
          if (
            activeBaselineTransaction &&
            activeBaselineTransaction.$rSegment === segment
          ) {
            // Meta + Focus + FullSnapshot is one replay baseline. An encoder
            // callback may run synchronously while those records are being
            // added; flushing after Meta would expose an incomplete baseline
            // and leave the following records without a current segment.
            activeBaselineTransaction.$rExceededSegmentBytesLimit = true
          } else {
            flushSegment('segment_bytes_limit')
          }
        }
        scheduleReplayResetNotification()
      },
      ignoreSegmentBytesLimit ? undefined : SEGMENT_BYTES_LIMIT,
      // The SDK time anchor is a fixed, tiny, state-free boundary. Give it a
      // small bounded reserve behind the regular worker backlog without
      // synchronously draining that backlog; segment size and async action
      // ordering remain unchanged.
      recordPendingRawBytesLimit,
      serializedRecordData
    )
    if (synchronousEncoderError) {
      return {
        status: 'encoder_error',
        error: synchronousEncoderError
      }
    }
    return addResult
  }

  function flushCanvasWithRateLimit() {
    const now = dateNow()
    const timeUntilNextFlush =
      CANVAS_FLUSH_MIN_INTERVAL - (now - lastCanvasFlushAt)
    if (timeUntilNextFlush <= 0) {
      lastCanvasFlushAt = now
      flushSegment('canvas_snapshot')
      return
    }
    if (canvasFlushTimeoutId === undefined) {
      canvasFlushTimeoutId = setTimeout(function () {
        canvasFlushTimeoutId = undefined
        lastCanvasFlushAt = dateNow()
        flushSegment('canvas_snapshot')
      }, timeUntilNextFlush)
    }
  }

  function addRecordWithBaselineGeneration(
    record,
    serializedRecordData,
    ignoreSegmentBytesLimit
  ) {
    var segmentState = state
    var previousBaselineGeneration = activeBaselineGeneration
    var previousSegmentBaselineGeneration = segmentState.$rGeneration
    var previousHasFullSnapshot = segmentState.$rHasSnapshot
    var fullSnapshotGeneration

    if (record.type === RecordType.FullSnapshot) {
      var previousActiveBaselineGeneration = activeBaselineGeneration
      fullSnapshotGeneration = ++nextBaselineGeneration
      activeBaselineGeneration = fullSnapshotGeneration
      baselineGenerationStates[fullSnapshotGeneration] = 'pending'
      segmentState.$rGeneration = fullSnapshotGeneration
      segmentState.$rHasSnapshot = true
    }

    var result = addRecordToCurrentSegment(
      record,
      serializedRecordData,
      ignoreSegmentBytesLimit
    )
    if (
      result.status === 'segment_full' &&
      fullSnapshotGeneration !== undefined
    ) {
      delete baselineGenerationStates[fullSnapshotGeneration]
      activeBaselineGeneration = previousBaselineGeneration
      segmentState.$rGeneration = previousSegmentBaselineGeneration
      segmentState.$rHasSnapshot = previousHasFullSnapshot
      fullSnapshotGeneration = undefined
    } else if (fullSnapshotGeneration !== undefined) {
      tryCleanupBaselineGeneration(previousActiveBaselineGeneration)
    }

    return {
      $rResult: result,
      $rGeneration: segmentState.$rGeneration
    }
  }

  function rejectRecordAdmission(wasBackpressured) {
    lastAddRecordWasBackpressured = Boolean(wasBackpressured)
    return false
  }

  function startFreshBaselineTransactionSegment() {
    if (
      state.$rStatus === SegmentCollectionStatus.SegmentPending &&
      !state.$rSegment.isEmpty()
    ) {
      if (state.$rMandatoryRecoveryHold) {
        discardCurrentSegment('mandatory_recovery_replaced')
      } else {
        flushSegment('full_snapshot')
      }
    }
    return ensureSegment()
  }

  function tryAddBaselineTransaction(records, ignoreSegmentBytesLimit) {
    var transaction = {
      $rSegment: state.$rSegment,
      $rExceededSegmentBytesLimit: false
    }
    activeBaselineTransaction = transaction
    var attempt
    try {
      for (var index = 0; index < records.length; index += 1) {
        var record = records[index]
        var addResult = addRecordWithBaselineGeneration(
          record,
          backpressuredSerializedRecordData.get(record),
          ignoreSegmentBytesLimit
        )
        if (addResult.$rResult.status !== 'added') {
          attempt = {
            $rAddResult: addResult,
            $rRecord: record
          }
          break
        }
      }
      if (!attempt) {
        attempt = {
          $rAddResult: addResult,
          $rRecord: records[records.length - 1]
        }
      }
    } finally {
      activeBaselineTransaction = undefined
    }
    attempt.$rExceededSegmentBytesLimit =
      transaction.$rExceededSegmentBytesLimit
    return attempt
  }

  function rejectBaselineTransaction(records, attempt) {
    var result = attempt.$rAddResult.$rResult
    var record = attempt.$rRecord
    records.forEach(function (baselineRecord) {
      backpressuredSerializedRecordData.delete(baselineRecord)
    })
    if (result.status === 'encoder_error') {
      mandatoryRecoveryPending = false
      bufferCheckoutPending = false
      discardCurrentSegment('baseline_transaction_encoder_error')
      return rejectRecordAdmission()
    }
    if (result.status === 'record_too_large') {
      reportDroppedRecord(
        record.type === RecordType.FullSnapshot
          ? 'full_snapshot_too_large'
          : 'record_too_large',
        result.estimatedBytesCount
      )
    } else {
      reportDroppedRecord(
        record.type === RecordType.FullSnapshot
          ? 'full_snapshot_encoder_backpressure'
          : 'encoder_backpressure',
        result.estimatedBytesCount
      )
    }
    if (record.type === RecordType.FullSnapshot) {
      failBaselineGeneration(
        attempt.$rAddResult.$rGeneration,
        result.status === 'record_too_large'
          ? 'full_snapshot_too_large'
          : 'full_snapshot_encoder_backpressure',
        result.status === 'record_too_large'
      )
    }
    mandatoryRecoveryPending = false
    bufferCheckoutPending = false
    discardCurrentSegment('baseline_transaction_rejected')
    return rejectRecordAdmission(result.status === 'encoder_backpressure')
  }

  function addBaselineRecords(records) {
    lastAddRecordWasBackpressured = false
    if (
      state.$rStatus === SegmentCollectionStatus.Stopped ||
      !records ||
      records.length !== 3 ||
      records[0].type !== RecordType.Meta ||
      records[1].type !== RecordType.Focus ||
      records[2].type !== RecordType.FullSnapshot ||
      !startFreshBaselineTransactionSegment()
    ) {
      return rejectRecordAdmission()
    }

    var attempt = tryAddBaselineTransaction(records, false)
    if (attempt.$rAddResult.$rResult.status === 'segment_full') {
      if (
        typeof attempt.$rAddResult.$rResult.serializedRecordData ===
        'string'
      ) {
        backpressuredSerializedRecordData.set(
          attempt.$rRecord,
          attempt.$rAddResult.$rResult.serializedRecordData
        )
      }
      // Meta and Focus are the prelude of the Full Snapshot, not independent
      // replay state. Retire this unsent attempt and replay the complete
      // transaction in a fresh segment. Like a Full Snapshot as the first
      // physical record, the retry may exceed the estimated segment target by
      // the small prelude; the finalized payload still goes through the hard
      // SEGMENT_BYTES_LIMIT delivery check.
      discardCurrentSegment('baseline_transaction_retry')
      if (!ensureSegment()) {
        return rejectRecordAdmission()
      }
      attempt = tryAddBaselineTransaction(records, true)
    }

    if (attempt.$rAddResult.$rResult.status !== 'added') {
      return rejectBaselineTransaction(records, attempt)
    }

    records.forEach(function (record) {
      backpressuredSerializedRecordData.delete(record)
    })
    if (mandatoryRecoveryPending) {
      mandatoryRecoveryPending = false
      bufferCheckoutPending = false
      state.$rMandatoryRecoveryHold = false
      flushSegment('mandatory_full_snapshot')
    } else if (attempt.$rExceededSegmentBytesLimit) {
      flushSegment('segment_bytes_limit')
    }
    return true
  }

  var segmentCollection = {
    $rAddBaselineRecords: addBaselineRecords,
    addRecord: function (record) {
      lastAddRecordWasBackpressured = false
      var isTimeAnchor = isSessionReplayTimeAnchor(record)
      if (state.$rStatus === SegmentCollectionStatus.Stopped) {
        return rejectRecordAdmission()
      }
      if (
        bufferCheckoutPending &&
        record.type !== RecordType.FullSnapshot &&
        record.type !== RecordType.Meta &&
        record.type !== RecordType.Focus
      ) {
        return rejectRecordAdmission()
      }
      if (
        replayResetNeeded &&
        record.type !== RecordType.FullSnapshot &&
        record.type !== RecordType.Meta &&
        record.type !== RecordType.Focus &&
        baselineGenerationStates[activeBaselineGeneration] !== 'pending'
      ) {
        return rejectRecordAdmission()
      }

      if (!ensureSegment()) {
        return rejectRecordAdmission()
      }

      var addResult = addRecordWithBaselineGeneration(
        record,
        backpressuredSerializedRecordData.get(record)
      )
      var result = addResult.$rResult
      if (result.status === 'segment_full') {
        var serializedRecordData = result.serializedRecordData
        if (state.$rMandatoryRecoveryHold) {
          discardCurrentSegment('mandatory_recovery_replaced')
        } else {
          flushSegment('segment_bytes_limit')
        }
        if (!ensureSegment()) {
          return rejectRecordAdmission()
        }
        addResult = addRecordWithBaselineGeneration(
          record,
          serializedRecordData
        )
        result = addResult.$rResult
      }

      if (result.status === 'record_too_large') {
        backpressuredSerializedRecordData.delete(record)
        reportDroppedRecord(
          'record_too_large',
          result.estimatedBytesCount
        )
        discardEmptyCurrentSegment('record_too_large')
        // Incremental admission fails synchronously, before the recorder
        // publishes any DOM membership carried by the record. Returning false
        // lets it cancel that staged membership, so the existing baseline
        // remains valid and does not need a global reset.
        if (
          record.type !== RecordType.IncrementalSnapshot &&
          !isTimeAnchor
        ) {
          failBaselineGeneration(
            addResult.$rGeneration,
            record.type === RecordType.FullSnapshot
              ? 'full_snapshot_too_large'
              : 'record_too_large',
            record.type === RecordType.FullSnapshot
          )
        }
        if (
          record.type === RecordType.FullSnapshot &&
          mandatoryRecoveryPending
        ) {
          mandatoryRecoveryPending = false
          bufferCheckoutPending = false
          discardCurrentSegment('mandatory_recovery_failed')
        }
        return rejectRecordAdmission()
      }
      if (result.status === 'encoder_backpressure') {
        if (typeof result.serializedRecordData === 'string') {
          backpressuredSerializedRecordData.set(
            record,
            result.serializedRecordData
          )
        }
        reportDroppedRecord(
          'encoder_backpressure',
          result.estimatedBytesCount
        )
        if (state.$rSegment.isEmpty()) {
          discardEmptyCurrentSegment('encoder_backpressure')
        } else {
          flushSegment('encoder_backpressure')
        }
        // See the synchronous incremental rejection rationale above. Full
        // snapshots and non-incremental baseline records retain the existing
        // recovery semantics.
        if (
          record.type !== RecordType.IncrementalSnapshot &&
          !isTimeAnchor
        ) {
          failBaselineGeneration(
            addResult.$rGeneration,
            record.type === RecordType.FullSnapshot
              ? 'full_snapshot_encoder_backpressure'
              : 'encoder_backpressure',
            false
          )
        }
        if (
          record.type === RecordType.FullSnapshot &&
          mandatoryRecoveryPending
        ) {
          mandatoryRecoveryPending = false
          bufferCheckoutPending = false
          discardCurrentSegment('mandatory_recovery_failed')
        }
        return rejectRecordAdmission(true)
      }

      backpressuredSerializedRecordData.delete(record)
      if (result.status === 'encoder_error') {
        if (
          record.type === RecordType.FullSnapshot &&
          mandatoryRecoveryPending
        ) {
          mandatoryRecoveryPending = false
          bufferCheckoutPending = false
          discardCurrentSegment('mandatory_recovery_failed')
        }
        return rejectRecordAdmission()
      }
      if (
        record.type === RecordType.FullSnapshot &&
        mandatoryRecoveryPending
      ) {
        mandatoryRecoveryPending = false
        bufferCheckoutPending = false
        state.$rMandatoryRecoveryHold = false
        flushSegment('mandatory_full_snapshot')
      }

      if (
        options.flushCanvasImmediately &&
        isCanvasMutationRecord(record) &&
        state.$rStatus === SegmentCollectionStatus.SegmentPending
      ) {
        flushCanvasWithRateLimit()
      }
      return true
    },
    $rWasLastAddRecordBackpressured: function () {
      return lastAddRecordWasBackpressured
    },

    unlockSegment: function () {
      state.$rLocked = false
      drainLockedSegments()
    },
    flushBufferSegment: function (callback) {
      if (bufferCheckoutPending) {
        return false
      }
      bufferCheckoutPending = true
      lockedBufferGeneration += 1
      lockedSegments = []
      var callbackWasInvoked = false
      flushSegment('buffer_checkout', function () {
        callbackWasInvoked = true
        beginMandatoryRecovery()
        if (callback) {
          callback()
        }
      })
      // A non-empty segment finishes asynchronously. Enter the hold before
      // application code can enqueue another record or unlock the error
      // session, so no post-checkout incrementals can be sent without the
      // replacement baseline.
      if (!callbackWasInvoked) {
        beginMandatoryRecovery()
      }
      return true
    },
    isLocked: function () {
      return state.$rLocked
    },
    $rBeginMandatoryRecovery: function () {
      beginMandatoryRecovery()
    },
    $rDiscardMandatoryRecovery: function () {
      if (!mandatoryRecoveryPending) {
        return
      }
      mandatoryRecoveryPending = false
      bufferCheckoutPending = false
      if (
        state.$rStatus === SegmentCollectionStatus.SegmentPending &&
        state.$rMandatoryRecoveryHold
      ) {
        discardCurrentSegment('mandatory_recovery_incomplete')
      }
    },
    stop: function (flushReason) {
      lockedBufferGeneration += 1
      lockedSegments = []
      bufferCheckoutPending = false
      clearCanvasFlushTimeout()
      clearReplayResetNotificationTimeout()
      upgradeSegmentTransportsForPageExit(flushReason)
      var stopEvent = isPageExitReason(flushReason)
        ? { reason: flushReason }
        : undefined
      prepareRecordsBeforePageExit(stopEvent)
      if (flushReason === PageExitReason.UNLOADING) {
        flushSegment(flushReason || 'stop')
        if (flushPendingSegmentEncodingsForUnload(flushReason)) {
          // A synchronous encoder drain can release admission backpressure.
          // Ask the still-active recorder for one final mutation pass before
          // terminally closing the second unload-safe segment.
          prepareRecordsBeforePageExit(stopEvent)
        }
      }
      flushSegment(flushReason || 'stop', undefined, true)
      // Normal stop/session renewal leaves shared encoder groups to complete
      // asynchronously. Only a real unload uses the bounded synchronous drain.
      flushPendingSegmentEncodingsForUnload(flushReason)
      unsubscribeLifecycle()
    }
  }
  if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
    segmentCollection.getBaselineGenerationStateCountForDebug = function () {
      return Object.keys(baselineGenerationStates).length
    }
  }
  return segmentCollection

  function beginMandatoryRecovery() {
    mandatoryRecoveryPending = true
    if (state.$rStatus === SegmentCollectionStatus.SegmentPending) {
      state.$rMandatoryRecoveryHold = true
      clearTimeout(state.$rExpiration)
    }
  }
}

function isCanvasMutationRecord(record) {
  return (
    record &&
    record.type === RecordType.IncrementalSnapshot &&
    record.data &&
    record.data.source === IncrementalSource.CanvasMutation
  )
}

export function computeSegmentContext(
  configuration,
  sessionManager,
  viewContexts
) {
  var session = sessionManager.findTrackedSession()
  var viewContext = viewContexts.findView()
  if (!session || !viewContext) {
    return undefined
  }
  return {
    sdk: {
      name: configuration.sdkName,
      version: configuration.sdkVersion
    },
    env: configuration.env || '',
    service: viewContext.service || configuration.service || 'browser',
    version: viewContext.version || configuration.version || '',
    app: {
      id: configuration.applicationId
    },
    session: {
      id: session.id
    },
    view: {
      id: viewContext.id
    }
  }
}

export function setSegmentBytesLimit(newSegmentBytesLimit = 60_000) {
  SEGMENT_BYTES_LIMIT = newSegmentBytesLimit
}
