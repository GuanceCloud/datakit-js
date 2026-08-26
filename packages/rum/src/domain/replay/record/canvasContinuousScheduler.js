import { addEventListener, DOM_EVENT } from '@cloudcare/browser-core'
import {
  getReplayCanvasRecordingDecision,
  isWebGLReplayCanvas
} from './canvasContext'

var CONTINUOUS_CANVAS_DEFAULT_TARGET_INTERVAL = 250
var CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL = 120
// Spread a bounded canvas batch over time instead of starting the next batch
// immediately. At 60 ms per snapshot attempt, one busy page is capped at
// roughly 16 attempts/second regardless of how many canvases it contains.
var CONTINUOUS_CANVAS_GLOBAL_SNAPSHOT_INTERVAL = 60
// Static canvases progressively reduce their cheap signature-probe cadence,
// while a changed canvas resets immediately to its configured target cadence.
// This leaves room for active charts without reintroducing multi-second blind
// spots after one below-threshold frame.
var CONTINUOUS_CANVAS_MAX_UNCHANGED_PROBE_INTERVAL = 1000
// Continue discovering newly serialized canvases while every known canvas is
// in cooldown/backoff, without returning to an always-on rAF scan.
var CONTINUOUS_CANVAS_DISCOVERY_INTERVAL = 500
var MAX_CONTINUOUS_CANVAS_SNAPSHOTS_PER_RUN = 8
var MAX_CONTINUOUS_CANVAS_CONCURRENCY = 4
var MAX_CONTINUOUS_CANVAS_SCAN_PER_RUN = 64

function isContinuousCanvasRecordingEnabled(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto'
  )
}

function clampInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), minimum), maximum)
}

function runWithConcurrency(items, maxConcurrency, task) {
  return new Promise(function (resolve) {
    var nextItemIndex = 0
    var activeCount = 0

    function runItem(item) {
      activeCount += 1
      Promise.resolve()
        .then(function () {
          return task(item)
        })
        .then(finishItem, finishItem)
    }

    function schedule() {
      if (nextItemIndex >= items.length && activeCount === 0) {
        resolve()
        return
      }
      while (
        activeCount < maxConcurrency &&
        nextItemIndex < items.length
      ) {
        var item = items[nextItemIndex]
        nextItemIndex += 1
        runItem(item)
      }
    }

    function finishItem() {
      activeCount -= 1
      schedule()
    }

    schedule()
  })
}

export function startContinuousCanvasSnapshotLoop(options) {
  var configuration = options.configuration
  var snapshotCanvas = options.snapshotCanvas
  var targetInterval =
    configuration.replayCanvasAutoInterval ||
    CONTINUOUS_CANVAS_DEFAULT_TARGET_INTERVAL
  var successCooldown =
    configuration.replayCanvasAutoCooldown ||
    CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL
  var failureCooldown =
    configuration.replayCanvasAutoFailureBackoff || successCooldown
  var now = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.now || Date.now
    : Date.now
  var getSerializedNodeId = options.getSerializedNodeId
  var onDebug = options.onDebug || function () {}
  var getVisibilityState =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.getVisibilityState) ||
    function () {
      return document.visibilityState
    }
  var getCanvases =
    options.getCanvases ||
    function () {
      return document.querySelectorAll('canvas')
    }
  var addEventListenerImpl = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.addEventListenerImpl || addEventListener
    : addEventListener
  var requestAnimationFrameImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
      options.requestAnimationFrameImpl) ||
    function (callback) {
      return window.requestAnimationFrame(callback)
    }
  var cancelAnimationFrameImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
      options.cancelAnimationFrameImpl) ||
    function (frameId) {
      return window.cancelAnimationFrame(frameId)
    }
  var setTimeoutImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.setTimeoutImpl) ||
    function (callback, delay) {
      return window.setTimeout(callback, delay)
    }
  var clearTimeoutImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.clearTimeoutImpl) ||
    function (timeoutId) {
      return window.clearTimeout(timeoutId)
    }

  var stopped = false
  var frameId
  var timeoutId
  var snapshotInProgress = false
  var visibilityChangeListener
  var generation = 0
  var pendingImmediateRunAfterReset = false
  var lastSnapshotAttemptOrderByCanvas = new WeakMap()
  var snapshotAttemptOrder = 0
  var nextEligibleAtByCanvas = new WeakMap()
  var unchangedProbeCountByCanvas = new WeakMap()
  var nextCanvasScanAt = 0
  var continuousCanvasScanCursor = 0
  var maxSnapshotsPerRun = clampInteger(
    configuration.replayCanvasAutoMaxPerRun,
    2,
    1,
    MAX_CONTINUOUS_CANVAS_SNAPSHOTS_PER_RUN
  )
  var maxConcurrentSnapshots = clampInteger(
    configuration.replayCanvasMaxConcurrentEncodes,
    1,
    1,
    Math.min(
      maxSnapshotsPerRun,
      MAX_CONTINUOUS_CANVAS_CONCURRENCY
    )
  )

  function clearScheduledWork() {
    if (frameId !== undefined) {
      cancelAnimationFrameImpl(frameId)
      frameId = undefined
    }
    if (timeoutId !== undefined) {
      clearTimeoutImpl(timeoutId)
      timeoutId = undefined
    }
  }

  function scheduleNextFrame() {
    if (
      stopped ||
      frameId !== undefined ||
      timeoutId !== undefined ||
      getVisibilityState() === 'hidden'
    ) {
      return
    }
    var delay = Math.max(nextCanvasScanAt - now(), 0)
    if (delay > 0) {
      timeoutId = setTimeoutImpl(function () {
        timeoutId = undefined
        scheduleNextFrame()
      }, delay)
      return
    }
    frameId = requestAnimationFrameImpl(function () {
      frameId = undefined
      runSnapshots()
    })
  }

  function stop() {
    if (stopped) {
      return
    }
    stopped = true
    generation += 1
    pendingImmediateRunAfterReset = false
    if (visibilityChangeListener) {
      visibilityChangeListener.stop()
    }
    clearScheduledWork()
  }

  function resetSchedulingState() {
    generation += 1
    lastSnapshotAttemptOrderByCanvas = new WeakMap()
    snapshotAttemptOrder = 0
    nextEligibleAtByCanvas = new WeakMap()
    unchangedProbeCountByCanvas = new WeakMap()
    nextCanvasScanAt = 0
    continuousCanvasScanCursor = 0
    clearScheduledWork()
  }

  function reset() {
    if (!isContinuousCanvasRecordingEnabled(configuration)) {
      return
    }
    resetSchedulingState()
    pendingImmediateRunAfterReset = !stopped && getVisibilityState() !== 'hidden'
    if (pendingImmediateRunAfterReset && !snapshotInProgress) {
      scheduleNextFrame()
    }
  }

  function requestResumeAfterPause() {
    if (stopped || getVisibilityState() === 'hidden') {
      return
    }
    if (snapshotInProgress) {
      pendingImmediateRunAfterReset = true
      return
    }
    scheduleNextFrame()
  }

  function runSnapshots() {
    if (stopped || snapshotInProgress) {
      return
    }
    if (getVisibilityState() === 'hidden') {
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        onDebug({
          scheduler: 'continuous_snapshot',
          status: 'skipped_hidden',
          startedAt: now(),
          completedAt: now(),
          timestamp: now(),
          eligibleCanvasCount: 0,
          selectedCanvasCount: 0,
          skippedBudgetCount: 0,
          results: []
        })
      }
      return
    }

    var startedAt = now()
    if (startedAt < nextCanvasScanAt) {
      scheduleNextFrame()
      return
    }
    var canvasCollection = getCanvases(MAX_CONTINUOUS_CANVAS_SCAN_PER_RUN)
    var canvasCount =
      canvasCollection && typeof canvasCollection.length === 'number'
        ? canvasCollection.length
        : 0
    var scannedCanvasCount = Math.min(
      canvasCount,
      MAX_CONTINUOUS_CANVAS_SCAN_PER_RUN
    )
    var priorityByCanvas = new Map()
    var canvases = []
    for (var offset = 0; offset < scannedCanvasCount; offset += 1) {
      var canvas =
        canvasCollection[
          (continuousCanvasScanCursor + offset) % canvasCount
        ]
      if (canvas && !isWebGLReplayCanvas(canvas)) {
        var decision = getReplayCanvasRecordingDecision(
          configuration,
          canvas
        )
        if (decision !== false) {
          priorityByCanvas.set(
            canvas,
            typeof decision === 'number' ? decision : 0
          )
          canvases.push(canvas)
        }
      }
    }
    continuousCanvasScanCursor = canvasCount
      ? (continuousCanvasScanCursor + scannedCanvasCount) % canvasCount
      : 0
    if (!canvases.length) {
      nextCanvasScanAt = startedAt + CONTINUOUS_CANVAS_DISCOVERY_INTERVAL
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        onDebug({
          scheduler: 'continuous_snapshot',
          status: 'skipped_no_candidates',
          startedAt: now(),
          completedAt: now(),
          timestamp: now(),
          eligibleCanvasCount: 0,
          selectedCanvasCount: 0,
          skippedBudgetCount: 0,
          results: []
        })
      }
      scheduleNextFrame()
      return
    }

    var nextKnownEligibility = Infinity
    var eligibleCanvases = canvases
      .filter(function (canvas) {
        var nextEligibility = nextEligibleAtByCanvas.get(canvas) || 0
        if (nextEligibility <= startedAt) {
          return true
        }
        nextKnownEligibility = Math.min(
          nextKnownEligibility,
          nextEligibility
        )
        return false
      })
      .sort(function (a, b) {
        // Complete a bounded round across every eligible canvas before a
        // higher priority canvas can start the next round.
        var attemptOrderDifference =
          (lastSnapshotAttemptOrderByCanvas.get(a) || 0) -
          (lastSnapshotAttemptOrderByCanvas.get(b) || 0)
        if (attemptOrderDifference) {
          return attemptOrderDifference
        }
        var priorityDifference =
          priorityByCanvas.get(b) - priorityByCanvas.get(a)
        if (priorityDifference) {
          return priorityDifference
        }
        return 0
      })
    var selectedCanvases = eligibleCanvases.slice(0, maxSnapshotsPerRun)
    if (!selectedCanvases.length) {
      nextCanvasScanAt = Math.min(
        nextKnownEligibility,
        startedAt + CONTINUOUS_CANVAS_DISCOVERY_INTERVAL
      )
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        onDebug({
          scheduler: 'continuous_snapshot',
          status: 'skipped_no_candidates',
          startedAt: startedAt,
          completedAt: now(),
          timestamp: now(),
          eligibleCanvasCount: canvases.length,
          selectedCanvasCount: 0,
          skippedBudgetCount: 0,
          keepSessionAliveTriggered: false,
          results: []
        })
      }
      scheduleNextFrame()
      return
    }
    selectedCanvases.forEach(function (canvas) {
      snapshotAttemptOrder += 1
      lastSnapshotAttemptOrderByCanvas.set(canvas, snapshotAttemptOrder)
    })
    if (eligibleCanvases.length > selectedCanvases.length) {
      nextKnownEligibility = 0
    }
    var summary = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? {
          scheduler: 'continuous_snapshot',
          status: 'completed',
          startedAt: startedAt,
          eligibleCanvasCount: canvases.length,
          selectedCanvasCount: selectedCanvases.length,
          skippedBudgetCount: Math.max(
            eligibleCanvases.length - selectedCanvases.length,
            0
          ),
          keepSessionAliveTriggered: false,
          results: []
        }
      : {
          status: 'completed',
          selectedCanvasCount: selectedCanvases.length,
          results: []
        }
    var runGeneration = generation
    snapshotInProgress = true

    function finishRun() {
      snapshotInProgress = false
      if (runGeneration !== generation) {
        if (pendingImmediateRunAfterReset) {
          pendingImmediateRunAfterReset = false
          scheduleNextFrame()
        }
        return
      }
      pendingImmediateRunAfterReset = false
      nextCanvasScanAt = Math.max(
        startedAt +
          selectedCanvases.length *
            CONTINUOUS_CANVAS_GLOBAL_SNAPSHOT_INTERVAL,
        Math.min(
          nextKnownEligibility,
          startedAt + CONTINUOUS_CANVAS_DISCOVERY_INTERVAL
        )
      )
      if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
        summary.completedAt = now()
        summary.timestamp = summary.completedAt
      }
      onDebug(summary)
      scheduleNextFrame()
    }

    runWithConcurrency(
      selectedCanvases,
      maxConcurrentSnapshots,
      function (canvas) {
        if (runGeneration !== generation || getVisibilityState() === 'hidden') {
          return {
            ok: false,
            reason: 'skipped_hidden'
          }
        }
        var serializedNodeId =
          __BUILD_ENV__REPLAY_DEBUG_ENABLED__ && getSerializedNodeId
            ? getSerializedNodeId(canvas)
            : undefined
        var snapshotStartedAt = now()
        function completeSnapshot(result) {
          if (runGeneration !== generation || getVisibilityState() === 'hidden') {
            return result
          }
          var failed = result && result.ok === false
          var unchanged =
            failed &&
            (result.reason === 'unchanged' ||
              result.reason === 'below_threshold')
          var unchangedProbeCount = 0
          if (unchanged) {
            unchangedProbeCount =
              (unchangedProbeCountByCanvas.get(canvas) || 0) + 1
            unchangedProbeCountByCanvas.set(canvas, unchangedProbeCount)
          } else {
            unchangedProbeCountByCanvas.delete(canvas)
          }
          var cooldown = unchanged
            ? Math.max(
                successCooldown,
                Math.min(
                  CONTINUOUS_CANVAS_MAX_UNCHANGED_PROBE_INTERVAL,
                  targetInterval * unchangedProbeCount
                )
              )
            : failed
              ? failureCooldown
              : successCooldown
          var nextEligibility = Math.max(
            snapshotStartedAt + targetInterval,
            now() + cooldown
          )
          nextEligibleAtByCanvas.set(canvas, nextEligibility)
          nextKnownEligibility = Math.min(
            nextKnownEligibility,
            nextEligibility
          )
          summary.results.push(
            __BUILD_ENV__REPLAY_DEBUG_ENABLED__
              ? {
                  canvasId: serializedNodeId,
                  ok: !failed,
                  reason: failed ? result.reason : undefined,
                  priority: priorityByCanvas.get(canvas)
                }
              : {
                  ok: !failed,
                  reason: failed ? result.reason : undefined
                }
          )
          return result
        }
        return Promise.resolve(snapshotCanvas(canvas))
          .then(completeSnapshot)
          .catch(function () {
            return completeSnapshot({
              ok: false,
              reason: 'encode_failed'
            })
          })
      }
    ).then(finishRun, finishRun)
  }

  if (!isContinuousCanvasRecordingEnabled(configuration)) {
    return {
      stop: stop,
      reset: reset
    }
  }

  scheduleNextFrame()

  visibilityChangeListener = addEventListenerImpl(
    document,
    DOM_EVENT.VISIBILITY_CHANGE,
    function () {
      if (getVisibilityState() !== 'hidden') {
        requestResumeAfterPause()
      } else {
        resetSchedulingState()
        pendingImmediateRunAfterReset = false
      }
    },
    { capture: true }
  )

  return {
    stop: stop,
    reset: reset
  }
}
