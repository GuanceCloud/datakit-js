import {
  noop,
  runOnReadyState,
  LifeCycleEventType,
  canUseEventBridge,
  bridgeSupports,
  BridgeCapability,
  PageExitReason
} from '@cloudcare/browser-core'

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
    return {
      start: noop,
      stop: noop,
      takeSubsequentFullSnapshot: noop,
      getReplayStats: function () {
        return undefined
      },
      onRumStart: noop,
      isRecording: function () {
        return false
      }
    }
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
            takeSubsequentFullSnapshot: recordingImpl.takeSubsequentFullSnapshot
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
      if (state.status === RecorderStatus.IntentToStart) {
        startStrategy()
      }
    },
    takeSubsequentFullSnapshot() {
      takeSubsequentFullSnapshot()
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
