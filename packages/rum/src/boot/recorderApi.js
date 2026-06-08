import {
  noop,
  runOnReadyState,
  LifeCycleEventType,
  canUseEventBridge,
  bridgeSupports,
  BridgeCapability,
  PageExitReason
} from '@cloudcare/browser-core'

import { makeRecorderApiStub } from './recorderApiStub'
import { getReplayStats as getReplayStatsImpl } from '../domain/replay/replayStats'
import {
  createDeflateEncoder,
  startDeflateWorker,
  DeflateWorkerStatus,
  getDeflateWorkerStatus,
  DeflateEncoderStreamId
} from '../domain/deflate'
var RecorderStatus = {
  // The recorder is stopped.
  Stopped: 0,
  // The user started the recording while it wasn't possible yet. The recorder should start as soon
  // as possible.
  IntentToStart: 1,
  // The recorder is starting. It does not record anything yet.
  Starting: 2,
  // The recorder is started, it records the session.
  Started: 3
}

export function makeRecorderApi(startRecordingImpl, createDeflateWorkerImpl) {
  if (
    (canUseEventBridge() && !bridgeSupports(BridgeCapability.RECORDS)) ||
    !isBrowserSupported()
  ) {
    return makeRecorderApiStub()
  }

  var state = {
    status: RecorderStatus.Stopped
  }

  var startStrategy = function () {
    state = { status: RecorderStatus.IntentToStart }
  }
  var stopStrategy = function () {
    state = { status: RecorderStatus.Stopped }
  }
  var takeSubsequentFullSnapshot = function () {}
  var snapshotCanvas = function () {
    return {
      ok: false,
      reason: 'not_recording'
    }
  }
  var getSerializedNodeIdForDebug = function () {
    return undefined
  }
  var getLastAutoCanvasSnapshotResultForDebug = function () {
    return undefined
  }
  var getAutoCanvasSnapshotDebugHistoryForDebug = function () {
    return undefined
  }
  var getLastCanvasMutationForDebug = function () {
    return undefined
  }
  var getCanvasMutationHistoryForDebug = function () {
    return undefined
  }
  var getLastDomMutationForDebug = function () {
    return undefined
  }
  var getDomMutationHistoryForDebug = function () {
    return undefined
  }
  var getLastReplaySegmentFlushForDebug = function () {
    return undefined
  }
  var getReplaySegmentFlushHistoryForDebug = function () {
    return undefined
  }
  var getReplayPerformanceForDebug = function () {
    return undefined
  }
  var flushReplayMutationsForDebug = noop
  return {
    start: function (options) {
      startStrategy(options)
    },
    stop: function () {
      stopStrategy()
    },

    onRumStart: function (
      lifeCycle,
      configuration,
      sessionManager,
      viewContexts,
      worker
    ) {
      lifeCycle.subscribe(LifeCycleEventType.SESSION_EXPIRED, function () {
        if (
          state.status === RecorderStatus.Starting ||
          state.status === RecorderStatus.Started
        ) {
          stopStrategy()
          state = { status: RecorderStatus.IntentToStart }
        }
      })
      lifeCycle.subscribe(
        LifeCycleEventType.PAGE_EXITED,
        function (pageExitEvent) {
          if (pageExitEvent.reason === PageExitReason.UNLOADING) {
            stopStrategy()
          }
        }
      )
      lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, function () {
        if (state.status === RecorderStatus.IntentToStart) {
          startStrategy()
        }
      })
      var cachedDeflateEncoder
      function getOrCreateDeflateEncoder() {
        if (!cachedDeflateEncoder) {
          if (!worker) {
            worker = startDeflateWorker(
              configuration,
              'Session Replay',
              function () {
                stopStrategy()
              },
              createDeflateWorkerImpl
            )
          }
          if (worker) {
            cachedDeflateEncoder = createDeflateEncoder(
              worker,
              DeflateEncoderStreamId.REPLAY
            )
          }
        }
        return cachedDeflateEncoder
      }
      startStrategy = function (options) {
        var session = sessionManager.findTrackedSession()
        if (!session || !session.sessionReplayAllowed) {
          state = { status: RecorderStatus.IntentToStart }
          return
        }

        if (
          state.status === RecorderStatus.Starting ||
          state.status === RecorderStatus.Started
        ) {
          return
        }

        state = { status: RecorderStatus.Starting }

        runOnReadyState('interactive', function () {
          if (state.status !== RecorderStatus.Starting) {
            return
          }
          var deflateEncoder = getOrCreateDeflateEncoder()
          if (!deflateEncoder) {
            state = {
              status: RecorderStatus.Stopped
            }
            return
          }
          var recordingImpl = startRecordingImpl(
            lifeCycle,
            configuration,
            sessionManager,
            viewContexts,
            deflateEncoder
          )
          state = {
            status: RecorderStatus.Started,
            stopRecording: recordingImpl.stop,
            takeSubsequentFullSnapshot: recordingImpl.takeSubsequentFullSnapshot,
            snapshotCanvas: recordingImpl.snapshotCanvas || noop,
            getSerializedNodeIdForDebug:
              recordingImpl.getSerializedNodeIdForDebug || noop,
            getLastAutoCanvasSnapshotResultForDebug:
              recordingImpl.getLastAutoCanvasSnapshotResultForDebug || noop,
            getAutoCanvasSnapshotDebugHistoryForDebug:
              recordingImpl.getAutoCanvasSnapshotDebugHistoryForDebug || noop,
            getLastCanvasMutationForDebug:
              recordingImpl.getLastCanvasMutationForDebug || noop,
            getCanvasMutationHistoryForDebug:
              recordingImpl.getCanvasMutationHistoryForDebug || noop,
            getLastDomMutationForDebug:
              recordingImpl.getLastDomMutationForDebug || noop,
            getDomMutationHistoryForDebug:
              recordingImpl.getDomMutationHistoryForDebug || noop,
            getLastReplaySegmentFlushForDebug:
              recordingImpl.getLastReplaySegmentFlushForDebug || noop,
            getReplaySegmentFlushHistoryForDebug:
              recordingImpl.getReplaySegmentFlushHistoryForDebug || noop,
            getReplayPerformanceForDebug:
              recordingImpl.getReplayPerformanceForDebug || noop,
            flushReplayMutationsForDebug:
              recordingImpl.flushReplayMutationsForDebug || noop
          }
        })
      }

      stopStrategy = function () {
        if (state.status === RecorderStatus.Stopped) {
          return
        }

        if (state.status === RecorderStatus.Started) {
          state.stopRecording()
        }

        state = {
          status: RecorderStatus.Stopped
        }
      }
      takeSubsequentFullSnapshot = function () {
        state.takeSubsequentFullSnapshot()
      }
      snapshotCanvas = function (canvas, options) {
        if (state.status === RecorderStatus.Started) {
          return state.snapshotCanvas(canvas, options)
        }
        return {
          ok: false,
          reason: 'not_recording'
        }
      }
      getSerializedNodeIdForDebug = function (node) {
        if (state.status === RecorderStatus.Started) {
          return state.getSerializedNodeIdForDebug(node)
        }
        return undefined
      }
      getLastAutoCanvasSnapshotResultForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getLastAutoCanvasSnapshotResultForDebug()
        }
        return undefined
      }
      getAutoCanvasSnapshotDebugHistoryForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getAutoCanvasSnapshotDebugHistoryForDebug()
        }
        return undefined
      }
      getLastCanvasMutationForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getLastCanvasMutationForDebug()
        }
        return undefined
      }
      getCanvasMutationHistoryForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getCanvasMutationHistoryForDebug()
        }
        return undefined
      }
      getLastDomMutationForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getLastDomMutationForDebug()
        }
        return undefined
      }
      getDomMutationHistoryForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getDomMutationHistoryForDebug()
        }
        return undefined
      }
      getLastReplaySegmentFlushForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getLastReplaySegmentFlushForDebug()
        }
        return undefined
      }
      getReplaySegmentFlushHistoryForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getReplaySegmentFlushHistoryForDebug()
        }
        return undefined
      }
      getReplayPerformanceForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          return state.getReplayPerformanceForDebug()
        }
        return undefined
      }
      flushReplayMutationsForDebug = function () {
        if (state.status === RecorderStatus.Started) {
          state.flushReplayMutationsForDebug()
        }
      }
      if (state.status === RecorderStatus.IntentToStart) {
        startStrategy()
      }
    },
    takeSubsequentFullSnapshot() {
      takeSubsequentFullSnapshot()
    },
    snapshotCanvas: function (canvas, options) {
      return snapshotCanvas(canvas, options)
    },
    getSerializedNodeIdForDebug: function (node) {
      return getSerializedNodeIdForDebug(node)
    },
    getLastReplaySegmentFlushForDebug: function () {
      return getLastReplaySegmentFlushForDebug()
    },
    getLastAutoCanvasSnapshotResultForDebug: function () {
      return getLastAutoCanvasSnapshotResultForDebug()
    },
    getAutoCanvasSnapshotDebugHistoryForDebug: function () {
      return getAutoCanvasSnapshotDebugHistoryForDebug()
    },
    getLastCanvasMutationForDebug: function () {
      return getLastCanvasMutationForDebug()
    },
    getCanvasMutationHistoryForDebug: function () {
      return getCanvasMutationHistoryForDebug()
    },
    getLastDomMutationForDebug: function () {
      return getLastDomMutationForDebug()
    },
    getDomMutationHistoryForDebug: function () {
      return getDomMutationHistoryForDebug()
    },
    getReplaySegmentFlushHistoryForDebug: function () {
      return getReplaySegmentFlushHistoryForDebug()
    },
    getReplayPerformanceForDebug: function () {
      return getReplayPerformanceForDebug()
    },
    flushReplayMutationsForDebug: function () {
      flushReplayMutationsForDebug()
    },
    isRecording: function () {
      return (
        getDeflateWorkerStatus() === DeflateWorkerStatus.Initialized &&
        state.status === RecorderStatus.Started
      )
    },
    getReplayStats: function (viewId) {
      return getDeflateWorkerStatus() === DeflateWorkerStatus.Initialized
        ? getReplayStatsImpl(viewId)
        : undefined
    }
  }
}

/**
 * Test for Browser features used while recording
 */
function isBrowserSupported() {
  return (
    // Array.from is a bit less supported by browsers than CSSSupportsRule, but has higher chances
    // to be polyfilled. Test for both to be more confident. We could add more things if we find out
    // this test is not sufficient.
    typeof Array.from === 'function' &&
    typeof CSSSupportsRule === 'function' &&
    typeof URL.createObjectURL === 'function' &&
    'forEach' in NodeList.prototype
  )
}
