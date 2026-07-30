import {
  timeStampNow,
  createHttpRequest,
  LifeCycleEventType,
  PageExitReason,
  addTelemetryDebug,
  ONE_SECOND,
  canUseEventBridge,
  assign
} from '@cloudcare/browser-core'
import { record } from '../domain/replay/record'
import { startRecordBridge } from '../domain/replay/startRecordBridge'
import {
  startSegmentCollection,
  SEGMENT_BYTES_LIMIT
} from '../domain/replay/segmentCollection'
import { RecordType } from '../types'
import { deleteOldestStats } from '../domain/replay/replayStats'
/* How long to wait for error checkouts */
export const BUFFER_CHECKOUT_TIME = 60 * ONE_SECOND
var REPLAY_SEGMENT_FLUSH_HISTORY_LIMIT = 10
export function startRecording(
  lifeCycle,
  configuration,
  sessionManager,
  viewContexts,
  encoder,
  httpRequest,
  onStopped
) {
  var cleanupTasks = []
  var isRecordingStopped = false
  var isRecordingReady = false
  var pendingStopRequested = false
  var pendingStopReason
  var stoppedNotificationSent = false
  var flushRecorderBeforePageExit = function () {}
  var replayResetRequestedBeforeRecorder = false
  var requestReplayReset = function () {
    replayResetRequestedBeforeRecorder = true
  }
  function notifyStopped(flushReason) {
    if (stoppedNotificationSent || !onStopped) {
      return
    }
    stoppedNotificationSent = true
    try {
      onStopped(flushReason)
    } catch (error) {
      addTelemetryDebug('Session Replay stopped callback failed.', {
        reason: flushReason,
        error: String(error)
      })
    }
  }
  function stopRecording(flushReason) {
    if (isRecordingStopped) {
      return
    }
    if (!isRecordingReady) {
      pendingStopRequested = true
      pendingStopReason = flushReason
      return
    }
    isRecordingStopped = true
    var firstCleanupError
    cleanupTasks
      .slice()
      .reverse()
      .forEach(function (task) {
        try {
          task(flushReason)
        } catch (error) {
          if (!firstCleanupError) {
            firstCleanupError = error
          }
        }
      })
    if (firstCleanupError) {
      addTelemetryDebug('Session Replay cleanup failed.', {
        reason: flushReason,
        error: String(firstCleanupError)
      })
    }
    notifyStopped(flushReason)
  }
  var lastReplaySegmentFlushForDebug
  var replaySegmentFlushHistoryForDebug =
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__ ? [] : undefined
  var replaySegmentFlushCount = 0
  var reportError = function (error) {
    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, { error: error })
    addTelemetryDebug('Error reported to customer', {
      'error.message': error.message
    })
  }

  try {
    var replayRequest =
      httpRequest ||
      createHttpRequest(
        configuration.sessionReplayEndPoint,
        SEGMENT_BYTES_LIMIT,
        configuration.retryMaxSize,
        reportError
      )

    let addRecord, addBaselineRecords, _record
    var stopSegmentCollection
    var beginMandatoryFullSnapshotRecovery = function () {}
    var discardMandatoryFullSnapshotRecovery = function () {}
    var wasLastEmitBackpressured = function () {}
    if (!canUseEventBridge()) {
      const session = sessionManager.findTrackedSession()
      let isRecordErrorSessionReplay =
        session && session.errorSessionReplayAllowed && !session.sessionHasError
      var segmentCollection = startSegmentCollection(
        lifeCycle,
        configuration,
        sessionManager,
        viewContexts,
        replayRequest,
        encoder,
        isRecordErrorSessionReplay,
        {
          beforePageExitFlush: function (pageExitEvent) {
            flushRecorderBeforePageExit(pageExitEvent)
          },
          onReplayResetNeeded: function (reason) {
            requestReplayReset(reason)
          },
          onReplayResetExhausted: function (reason) {
            stopRecording(reason || 'full_snapshot_failure_limit')
          },
          onSegmentFlushed: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
            ? function (segmentFlush) {
                replaySegmentFlushCount += 1
                lastReplaySegmentFlushForDebug =
                  cloneReplaySegmentFlushForDebug(
                    segmentFlush,
                    replaySegmentFlushCount
                  )
                replaySegmentFlushHistoryForDebug.push(
                  lastReplaySegmentFlushForDebug
                )
                if (
                  replaySegmentFlushHistoryForDebug.length >
                  REPLAY_SEGMENT_FLUSH_HISTORY_LIMIT
                ) {
                  replaySegmentFlushHistoryForDebug.shift()
                }
              }
            : undefined
        }
      )
      addRecord = segmentCollection.addRecord
      addBaselineRecords = segmentCollection.$rAddBaselineRecords
      wasLastEmitBackpressured =
        segmentCollection.$rWasLastAddRecordBackpressured ||
        wasLastEmitBackpressured
      beginMandatoryFullSnapshotRecovery =
        segmentCollection.$rBeginMandatoryRecovery ||
        beginMandatoryFullSnapshotRecovery
      discardMandatoryFullSnapshotRecovery =
        segmentCollection.$rDiscardMandatoryRecovery ||
        discardMandatoryFullSnapshotRecovery
      let flushBufferSegment = segmentCollection.flushBufferSegment
      let unlockSegment = segmentCollection.unlockSegment
      stopSegmentCollection = segmentCollection.stop
      if (isRecordErrorSessionReplay) {
        var sessionStateUpdateSubscription =
          sessionManager.sessionStateUpdateObservable.subscribe(
            ({ previousState, newState }) => {
              if (!previousState.hasError && newState.hasError) {
                isRecordErrorSessionReplay = false
                unlockSegment()
              }
            }
          )
        cleanupTasks.push(sessionStateUpdateSubscription.unsubscribe)
      }
      let lastFullSnapshotEvent = null
      const wrappedEmit = (recordData) => {
        const accepted = addRecord(recordData)
        if (accepted !== false && isRecordErrorSessionReplay) {
          if (recordData.type === RecordType.FullSnapshot) {
            lastFullSnapshotEvent = recordData
          } else if (recordData.type === RecordType.IncrementalSnapshot) {
            const exceedTime =
              recordData.timestamp - lastFullSnapshotEvent.timestamp >
              BUFFER_CHECKOUT_TIME
            // If the time between the last full snapshot and the incremental snapshot is greater than the buffer time, we need to take a new full snapshot
            if (exceedTime) {
              flushBufferSegment(() => {
                deleteOldestStats()
                takeSubsequentFullSnapshot()
              })
            }
          }
        }
        return accepted
      }
      const wrappedEmitBaseline = (records) => {
        const accepted = addBaselineRecords(records)
        if (accepted !== false && isRecordErrorSessionReplay) {
          lastFullSnapshotEvent = records[records.length - 1]
        }
        return accepted
      }
      _record = record({
        emit: wrappedEmit,
        $rEmitBaseline: wrappedEmitBaseline,
        configuration: configuration,
        lifeCycle: lifeCycle,
        sessionManager: sessionManager,
        $rWasLastEmitBackpressured: wasLastEmitBackpressured,
        $rOnMandatoryFullSnapshotStarted:
          beginMandatoryFullSnapshotRecovery,
        $rOnMandatoryFullSnapshotAbandoned:
          discardMandatoryFullSnapshotRecovery,
        onFullSnapshotFailure: stopRecording
      })
    } else {
      ;({ addRecord } = startRecordBridge(viewContexts))
      _record = record({
        emit: addRecord,
        configuration: configuration,
        lifeCycle: lifeCycle,
        sessionManager: sessionManager,
        $rWasLastEmitBackpressured: wasLastEmitBackpressured,
        $rOnMandatoryFullSnapshotStarted:
          beginMandatoryFullSnapshotRecovery,
        $rOnMandatoryFullSnapshotAbandoned:
          discardMandatoryFullSnapshotRecovery,
        onFullSnapshotFailure: stopRecording
      })
    }
    cleanupTasks.push(_record.stop)
    if (stopSegmentCollection) {
      // Stop the segment collection first (cleanup tasks run in reverse).
      // Its beforePageExitFlush hook can then drain the still-live recorder,
      // including a second unload pass after synchronous encoder backpressure
      // is released, before the observers are torn down.
      cleanupTasks.push(stopSegmentCollection)
    }
    var takeSubsequentFullSnapshot = _record.takeSubsequentFullSnapshot
    var flushScheduledFullSnapshot =
      _record.flushScheduledFullSnapshot || function () {}
    flushRecorderBeforePageExit = function (pageExitEvent) {
      if (
        pageExitEvent &&
        pageExitEvent.reason !== PageExitReason.UNLOADING
      ) {
        // Hidden, frozen, and pagehide states can resume in the same view.
        // Keep an in-progress DOM recovery baseline scheduled so later
        // mutations are never attached to the stale pre-overflow snapshot.
        _record.flushMutations()
        return
      }
      if (!flushScheduledFullSnapshot()) {
        _record.flushMutations()
      }
    }
    requestReplayReset = createReplayResetScheduler(
      takeSubsequentFullSnapshot,
      cleanupTasks
    )
    if (replayResetRequestedBeforeRecorder) {
      requestReplayReset()
    }
    var scheduleSubsequentFullSnapshot =
      _record.scheduleSubsequentFullSnapshot || takeSubsequentFullSnapshot
    var prepareForViewChange =
      _record.prepareForViewChange || _record.flushMutations
    var snapshotCanvas = _record.snapshotCanvas
    var getSerializedNodeIdForDebug = _record.getSerializedNodeIdForDebug
    var recordingDebug
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      recordingDebug = {
        getLastAutoCanvasSnapshotResultForDebug:
          _record.getLastAutoCanvasSnapshotResultForDebug,
        getAutoCanvasSnapshotDebugHistoryForDebug:
          _record.getAutoCanvasSnapshotDebugHistoryForDebug,
        getLastCanvasMutationForDebug:
          _record.getLastCanvasMutationForDebug,
        getCanvasMutationHistoryForDebug:
          _record.getCanvasMutationHistoryForDebug,
        getLastDomMutationForDebug: _record.getLastDomMutationForDebug,
        getDomMutationHistoryForDebug:
          _record.getDomMutationHistoryForDebug,
        getReplayPerformanceForDebug: function () {
          return cloneReplayPerformanceForDebug(
            _record.getReplayPerformanceForDebug
              ? _record.getReplayPerformanceForDebug()
              : undefined,
            replaySegmentFlushCount
          )
        },
        getLastReplaySegmentFlushForDebug: function () {
          return cloneReplaySegmentFlushForDebug(
            lastReplaySegmentFlushForDebug
          )
        },
        getReplaySegmentFlushHistoryForDebug: function () {
          return replaySegmentFlushHistoryForDebug.map(function (
            segmentFlush
          ) {
            return cloneReplaySegmentFlushForDebug(segmentFlush)
          })
        }
      }
    }
    var flushMutations = _record.flushMutations
    var subscribeViewEnded = lifeCycle.subscribe(
      LifeCycleEventType.VIEW_ENDED,
      function () {
        if (!flushScheduledFullSnapshot(true, true)) {
          // Preserve DOM changes still queued by the native MutationObservers.
          // The next view snapshot has not been scheduled yet, so resetting the
          // observers here would otherwise lose the old view's final state.
          flushMutations()
        }
        prepareForViewChange()
        addRecord({
          timestamp: timeStampNow(),
          type: RecordType.ViewEnd
        })
      }
    )
    cleanupTasks.push(subscribeViewEnded.unsubscribe)
    var scribeViewCreated = lifeCycle.subscribe(
      LifeCycleEventType.VIEW_CREATED,
      function (view) {
        scheduleSubsequentFullSnapshot(view.startClocks.timeStamp)
      }
    )
    cleanupTasks.push(scribeViewCreated.unsubscribe)
    isRecordingReady = true
    if (pendingStopRequested) {
      stopRecording(pendingStopReason)
    }
  } catch (error) {
    isRecordingReady = true
    stopRecording('start_failure')
    throw error
  }

  var recording = {
    stop: stopRecording,
    isStopped: function () {
      return isRecordingStopped
    },
    takeSubsequentFullSnapshot: takeSubsequentFullSnapshot,
    snapshotCanvas: snapshotCanvas,
    getSerializedNodeIdForDebug: getSerializedNodeIdForDebug,
    flushReplayMutationsForDebug: flushMutations
  }
  if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
    assign(recording, recordingDebug)
  }
  return recording
}

function createReplayResetScheduler(takeSubsequentFullSnapshot, cleanupTasks) {
  var stopped = false
  var pending = false
  var lastResetAt = -Infinity
  var resetTimeoutId
  var RESET_MIN_INTERVAL = ONE_SECOND

  function runReset() {
    resetTimeoutId = undefined
    if (stopped || !pending) {
      return
    }
    pending = false
    lastResetAt = Date.now()
    takeSubsequentFullSnapshot()
  }

  cleanupTasks.push(function () {
    stopped = true
    if (resetTimeoutId !== undefined) {
      clearTimeout(resetTimeoutId)
      resetTimeoutId = undefined
    }
  })

  return function () {
    if (stopped) {
      return
    }
    pending = true
    if (resetTimeoutId !== undefined) {
      return
    }
    var delay = Math.max(lastResetAt + RESET_MIN_INTERVAL - Date.now(), 0)
    resetTimeoutId = setTimeout(runReset, delay)
  }
}

function cloneReplaySegmentFlushForDebug(segmentFlush, sequence) {
  if (!segmentFlush) {
    return segmentFlush
  }

  return {
    sequence: typeof sequence === 'number' ? sequence : segmentFlush.sequence,
    creationReason: segmentFlush.creationReason,
    flushReason: segmentFlush.flushReason,
    recordsCount: segmentFlush.recordsCount,
    recordCountsByType: assign({}, segmentFlush.recordCountsByType),
    start: segmentFlush.start,
    end: segmentFlush.end,
    indexInView: segmentFlush.indexInView,
    rawBytesCount: segmentFlush.rawBytesCount
  }
}

function cloneReplayPerformanceForDebug(stats, replaySegmentFlushCount) {
  if (!stats && typeof replaySegmentFlushCount === 'undefined') {
    return undefined
  }

  return assign({}, stats || {}, {
    replaySegmentFlushCount: replaySegmentFlushCount || 0
  })
}
