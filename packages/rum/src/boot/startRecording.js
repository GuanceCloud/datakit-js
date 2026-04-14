import {
  timeStampNow,
  createHttpRequest,
  LifeCycleEventType,
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
  httpRequest
) {
  var cleanupTasks = []
  var lastReplaySegmentFlushForDebug
  var replaySegmentFlushHistoryForDebug = []
  var replaySegmentFlushCount = 0
  var reportError = function (error) {
    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, { error: error })
    addTelemetryDebug('Error reported to customer', {
      'error.message': error.message
    })
  }

  var replayRequest =
    httpRequest ||
    createHttpRequest(
      configuration.sessionReplayEndPoint,
      SEGMENT_BYTES_LIMIT,
      configuration.retryMaxSize,
      reportError
    )

  let addRecord, _record
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
        onSegmentFlushed: function (segmentFlush) {
          replaySegmentFlushCount += 1
          lastReplaySegmentFlushForDebug =
            cloneReplaySegmentFlushForDebug(segmentFlush)
          replaySegmentFlushHistoryForDebug.push(lastReplaySegmentFlushForDebug)
          if (
            replaySegmentFlushHistoryForDebug.length >
            REPLAY_SEGMENT_FLUSH_HISTORY_LIMIT
          ) {
            replaySegmentFlushHistoryForDebug.shift()
          }
        }
      }
    )
    addRecord = segmentCollection.addRecord
    let flushBufferSegment = segmentCollection.flushBufferSegment
    let unlockSegment = segmentCollection.unlockSegment
    cleanupTasks.push(segmentCollection.stop)
    if (isRecordErrorSessionReplay) {
      sessionManager.sessionStateUpdateObservable.subscribe(
        ({ previousState, newState }) => {
          if (!previousState.hasError && newState.hasError) {
            isRecordErrorSessionReplay = false
            unlockSegment()
          }
        }
      )
    }
    let lastFullSnapshotEvent = null
    const wrappedEmit = (recordData) => {
      addRecord(recordData)
      if (isRecordErrorSessionReplay) {
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
    }
    _record = record({
      emit: wrappedEmit,
      configuration: configuration,
      lifeCycle: lifeCycle,
      sessionManager: sessionManager
    })
  } else {
    ;({ addRecord } = startRecordBridge(viewContexts))
    _record = record({
      emit: addRecord,
      configuration: configuration,
      lifeCycle: lifeCycle,
      sessionManager: sessionManager
    })
  }
  cleanupTasks.push(_record.stop)
  var takeSubsequentFullSnapshot = _record.takeSubsequentFullSnapshot
  var snapshotCanvas = _record.snapshotCanvas
  var getSerializedNodeIdForDebug = _record.getSerializedNodeIdForDebug
  var getLastAutoCanvasSnapshotResultForDebug =
    _record.getLastAutoCanvasSnapshotResultForDebug
  var getAutoCanvasSnapshotDebugHistoryForDebug =
    _record.getAutoCanvasSnapshotDebugHistoryForDebug
  var getLastCanvasMutationForDebug = _record.getLastCanvasMutationForDebug
  var getCanvasMutationHistoryForDebug =
    _record.getCanvasMutationHistoryForDebug
  var getReplayPerformanceForDebug = function () {
    return cloneReplayPerformanceForDebug(
      _record.getReplayPerformanceForDebug
        ? _record.getReplayPerformanceForDebug()
        : undefined,
      replaySegmentFlushCount
    )
  }
  var getLastReplaySegmentFlushForDebug = function () {
    return cloneReplaySegmentFlushForDebug(lastReplaySegmentFlushForDebug)
  }
  var getReplaySegmentFlushHistoryForDebug = function () {
    return replaySegmentFlushHistoryForDebug.map(function (segmentFlush) {
      return cloneReplaySegmentFlushForDebug(segmentFlush)
    })
  }
  var flushMutations = _record.flushMutations
  var subscribeViewEnded = lifeCycle.subscribe(
    LifeCycleEventType.VIEW_ENDED,
    function () {
      flushMutations()
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
      takeSubsequentFullSnapshot(view.startClocks.timeStamp)
    }
  )
  cleanupTasks.push(scribeViewCreated.unsubscribe)

  return {
    stop: function () {
      cleanupTasks.forEach(function (task) {
        task()
      })
    },
    takeSubsequentFullSnapshot: takeSubsequentFullSnapshot,
    snapshotCanvas: snapshotCanvas,
    getSerializedNodeIdForDebug: getSerializedNodeIdForDebug,
    getLastAutoCanvasSnapshotResultForDebug:
      getLastAutoCanvasSnapshotResultForDebug,
    getAutoCanvasSnapshotDebugHistoryForDebug:
      getAutoCanvasSnapshotDebugHistoryForDebug,
    getLastCanvasMutationForDebug: getLastCanvasMutationForDebug,
    getCanvasMutationHistoryForDebug: getCanvasMutationHistoryForDebug,
    getLastReplaySegmentFlushForDebug: getLastReplaySegmentFlushForDebug,
    getReplaySegmentFlushHistoryForDebug:
      getReplaySegmentFlushHistoryForDebug,
    getReplayPerformanceForDebug: getReplayPerformanceForDebug
  }
}

function cloneReplaySegmentFlushForDebug(segmentFlush) {
  if (!segmentFlush) {
    return segmentFlush
  }

  return {
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
