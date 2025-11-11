import {
  timeStampNow,
  createHttpRequest,
  LifeCycleEventType,
  addTelemetryDebug,
  ONE_SECOND,
  canUseEventBridge
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
export function startRecording(
  lifeCycle,
  configuration,
  sessionManager,
  viewContexts,
  encoder,
  httpRequest
) {
  var cleanupTasks = []
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
      isRecordErrorSessionReplay
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
      lifeCycle: lifeCycle
    })
  } else {
    ;({ addRecord } = startRecordBridge(viewContexts))
    _record = record({
      emit: addRecord,
      configuration: configuration,
      lifeCycle: lifeCycle
    })
  }
  cleanupTasks.push(_record.stop)
  var takeSubsequentFullSnapshot = _record.takeSubsequentFullSnapshot
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
    takeSubsequentFullSnapshot: takeSubsequentFullSnapshot
  }
}
