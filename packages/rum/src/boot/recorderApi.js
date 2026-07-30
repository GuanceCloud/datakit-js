import {
  noop,
  runOnReadyState,
  LifeCycleEventType,
  canUseEventBridge,
  bridgeSupports,
  BridgeCapability,
  PageExitReason,
  monitorError
} from '@cloudcare/browser-core'

import { makeRecorderApiStub } from './recorderApiStub'
import { getReplayStats as getReplayStatsImpl } from '../domain/replay/replayStats'
import {
  createDeflateEncoder,
  DeflateWorkerStatus,
  getDeflateWorkerStatus,
  DeflateEncoderStreamId
} from '../domain/deflate'
import { createDeflateWorkerController } from '../domain/deflate/deflateWorker'
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

function createNotRecordingCanvasResult() {
  return Promise.resolve({
    ok: false,
    reason: 'not_recording'
  })
}

export function makeRecorderApi(startRecordingImpl, createDeflateWorkerImpl) {
  if (
    (canUseEventBridge() && !bridgeSupports(BridgeCapability.RECORDS)) ||
    !isBrowserSupported()
  ) {
    return makeRecorderApiStub()
  }

  var state = {
    $rStatus: RecorderStatus.Stopped
  }
  var nextRecordingToken = 0
  var unloadRecoveryGeneration = 0
  var replayDeflateWorkerController = createDeflateWorkerController()
  var getReplayWorkerStatus = function () {
    return replayDeflateWorkerController.getStatus()
  }

  function reconcileStoppedRecordingState() {
    if (
      state.$rStatus === RecorderStatus.Started &&
      state.$rIsStopped &&
      state.$rIsStopped()
    ) {
      state = { $rStatus: RecorderStatus.Stopped }
    }
  }

  var startStrategy = function (options) {
    state = {
      $rStatus: RecorderStatus.IntentToStart,
      $rOptions: options
    }
  }
  var stopStrategy = function () {
    unloadRecoveryGeneration += 1
    state = { $rStatus: RecorderStatus.Stopped }
  }
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
      compressionWorker
    ) {
      lifeCycle.subscribe(LifeCycleEventType.SESSION_EXPIRED, function () {
        if (
          state.$rStatus === RecorderStatus.Starting ||
          state.$rStatus === RecorderStatus.Started
        ) {
          var options = state.$rOptions
          stopStrategy()
          state = {
            $rStatus: RecorderStatus.IntentToStart,
            $rOptions: options
          }
        }
      })
      lifeCycle.subscribe(
        LifeCycleEventType.PAGE_EXITED,
        function (pageExitEvent) {
          if (pageExitEvent.reason === PageExitReason.UNLOADING) {
            var shouldRecoverCanceledUnload =
              state.$rStatus === RecorderStatus.IntentToStart ||
              state.$rStatus === RecorderStatus.Starting ||
              state.$rStatus === RecorderStatus.Started
            var recoveryOptions =
              state.$rOptions && state.$rOptions.force
                ? undefined
                : state.$rOptions
            stopStrategy(pageExitEvent.reason)
            if (
              shouldRecoverCanceledUnload &&
              typeof pageExitEvent.$rOnCancel === 'function'
            ) {
              var recoveryGeneration = unloadRecoveryGeneration
              pageExitEvent.$rOnCancel(function () {
                if (
                  recoveryGeneration === unloadRecoveryGeneration &&
                  state.$rStatus === RecorderStatus.Stopped
                ) {
                  startStrategy(recoveryOptions)
                }
              })
            }
          }
        }
      )
      lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, function () {
        if (state.$rStatus === RecorderStatus.IntentToStart) {
          startStrategy(state.$rOptions)
        }
      })
      if (sessionManager.sessionStateUpdateObservable) {
        sessionManager.sessionStateUpdateObservable.subscribe(function ({
          previousState,
          newState
        }) {
          if (
            state.$rStatus === RecorderStatus.IntentToStart &&
            !previousState.forcedSession &&
            newState.forcedSession
          ) {
            startStrategy(state.$rOptions)
          }
        })
      }
      var cachedDeflateEncoder
      var replayWorker = compressionWorker
      var replayWorkerOwnership = compressionWorker ? 'shared' : 'none'
      function handleDeflateWorkerFailure() {
        var failedDeflateEncoder = cachedDeflateEncoder
        cachedDeflateEncoder = undefined
        stopStrategy()
        if (failedDeflateEncoder) {
          failedDeflateEncoder.stop()
        }
        if (replayWorkerOwnership === 'owned') {
          replayWorker = undefined
          replayWorkerOwnership = 'none'
          replayDeflateWorkerController.reset()
        } else if (replayWorkerOwnership === 'shared') {
          // The compression worker belongs to the RUM transport. A replay
          // stream failure must not terminate or reset that shared worker.
          // Detach replay from it so an explicit restart can fall back to an
          // isolated worker instead of remaining disabled for the whole page.
          replayWorker = undefined
          replayWorkerOwnership = 'none'
        }
      }
      function getOrCreateDeflateEncoder() {
        if (!cachedDeflateEncoder) {
          if (!replayWorker) {
            // Mark ownership before start(): worker creation can fail
            // synchronously and invoke the failure callback before start()
            // returns.
            replayWorkerOwnership = 'owned'
            replayWorker = replayDeflateWorkerController.start(
              configuration,
              'Session Replay',
              handleDeflateWorkerFailure,
              createDeflateWorkerImpl
            )
          }
          if (replayWorker) {
            cachedDeflateEncoder = createDeflateEncoder(
              replayWorker,
              DeflateEncoderStreamId.REPLAY,
              handleDeflateWorkerFailure
            )
          }
        }
        return cachedDeflateEncoder
      }
      getReplayWorkerStatus = function () {
        if (replayWorkerOwnership === 'shared') {
          return getDeflateWorkerStatus()
        }
        return replayDeflateWorkerController.getStatus()
      }
      startStrategy = function (options) {
        reconcileStoppedRecordingState()
        if (
          state.$rStatus === RecorderStatus.Starting ||
          state.$rStatus === RecorderStatus.Started
        ) {
          if (options && options.force) {
            sessionManager.setForcedSession()
          }
          return
        }

        if (options && options.force) {
          // A forced session renewal emits SESSION_RENEWED synchronously. Leave
          // the intent state temporarily to avoid starting the recorder twice.
          state = { $rStatus: RecorderStatus.Stopped }
          sessionManager.setForcedSession()
        }
        var session = sessionManager.findTrackedSession()
        if (!session || !session.sessionReplayAllowed) {
          state = {
            $rStatus: RecorderStatus.IntentToStart,
            $rOptions: options
          }
          return
        }

        var recordingToken = ++nextRecordingToken
        state = {
          $rStatus: RecorderStatus.Starting,
          $rToken: recordingToken,
          $rOptions: options
        }

        runOnReadyState('interactive', function () {
          if (
            state.$rStatus !== RecorderStatus.Starting ||
            state.$rToken !== recordingToken
          ) {
            return
          }
          var deflateEncoder = getOrCreateDeflateEncoder()
          if (!deflateEncoder) {
            state = {
              $rStatus: RecorderStatus.Stopped
            }
            return
          }
          try {
            var recordingImpl = startRecordingImpl(
              lifeCycle,
              configuration,
              sessionManager,
              viewContexts,
              deflateEncoder,
              undefined,
              function () {
                if (
                  (state.$rStatus === RecorderStatus.Starting ||
                    state.$rStatus === RecorderStatus.Started) &&
                  state.$rToken === recordingToken
                ) {
                  state = { $rStatus: RecorderStatus.Stopped }
                }
              }
            )
            if (
              state.$rStatus !== RecorderStatus.Starting ||
              state.$rToken !== recordingToken
            ) {
              recordingImpl.stop()
              return
            }
            if (recordingImpl.isStopped && recordingImpl.isStopped()) {
              state = {
                $rStatus: RecorderStatus.Stopped
              }
              return
            }
            state = {
              $rStatus: RecorderStatus.Started,
              $rToken: recordingToken,
              $rOptions: options,
              $rStop: recordingImpl.stop,
              $rIsStopped: recordingImpl.isStopped,
              $rFullSnapshot:
                recordingImpl.takeSubsequentFullSnapshot,
              $rCanvas:
                recordingImpl.snapshotCanvas ||
                createNotRecordingCanvasResult,
              $rNode:
                recordingImpl.getSerializedNodeIdForDebug || noop,
              $rFlushMutations:
                recordingImpl.flushReplayMutationsForDebug || noop
            }
            if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
              state.$rDebug = [
                recordingImpl.getLastAutoCanvasSnapshotResultForDebug ||
                  noop,
                recordingImpl.getAutoCanvasSnapshotDebugHistoryForDebug ||
                  noop,
                recordingImpl.getLastCanvasMutationForDebug || noop,
                recordingImpl.getCanvasMutationHistoryForDebug || noop,
                recordingImpl.getLastDomMutationForDebug || noop,
                recordingImpl.getDomMutationHistoryForDebug || noop,
                recordingImpl.getLastReplaySegmentFlushForDebug || noop,
                recordingImpl.getReplaySegmentFlushHistoryForDebug || noop,
                recordingImpl.getReplayPerformanceForDebug || noop
              ]
            }
          } catch (error) {
            if (
              state.$rStatus === RecorderStatus.Starting &&
              state.$rToken === recordingToken
            ) {
              state = { $rStatus: RecorderStatus.Stopped }
            }
            if (
              cachedDeflateEncoder === deflateEncoder &&
              !(
                (state.$rStatus === RecorderStatus.Starting ||
                  state.$rStatus === RecorderStatus.Started) &&
                state.$rToken !== recordingToken
              )
            ) {
              cachedDeflateEncoder = undefined
              deflateEncoder.stop()
            }
            monitorError(error)
          }
        })
      }

      stopStrategy = function (flushReason) {
        unloadRecoveryGeneration += 1
        if (state.$rStatus === RecorderStatus.Stopped) {
          return
        }

        var stopRecording =
          state.$rStatus === RecorderStatus.Started
            ? state.$rStop
            : undefined
        state = {
          $rStatus: RecorderStatus.Stopped
        }
        if (stopRecording) {
          stopRecording(flushReason)
        }
      }
      if (state.$rStatus === RecorderStatus.IntentToStart) {
        startStrategy(state.$rOptions)
      }
    },
    takeSubsequentFullSnapshot() {
      if (state.$rStatus === RecorderStatus.Started) {
        state.$rFullSnapshot()
      }
    },
    snapshotCanvas: function (canvas, options) {
      return state.$rStatus === RecorderStatus.Started
        ? state.$rCanvas(canvas, options)
        : createNotRecordingCanvasResult()
    },
    getSerializedNodeIdForDebug: function (node) {
      if (state.$rStatus === RecorderStatus.Started) {
        return state.$rNode(node)
      }
    },
    $rGetDebug: function (debugIndex) {
      if (state.$rStatus === RecorderStatus.Started) {
        if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
          return state.$rDebug[debugIndex]()
        }
        // The odd indexes are the four history getters. In production their
        // backing history is intentionally disabled, but a running recorder
        // still exposes an empty history just as the previous methods did.
        if (debugIndex < 8 && debugIndex % 2 === 1) {
          return []
        }
      }
    },
    flushReplayMutationsForDebug: function () {
      if (state.$rStatus === RecorderStatus.Started) {
        state.$rFlushMutations()
      }
    },
    isRecording: function () {
      reconcileStoppedRecordingState()
      return (
        getReplayWorkerStatus() === DeflateWorkerStatus.Initialized &&
        state.$rStatus === RecorderStatus.Started
      )
    },
    getReplayStats: function (viewId) {
      return getReplayWorkerStatus() === DeflateWorkerStatus.Initialized
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
