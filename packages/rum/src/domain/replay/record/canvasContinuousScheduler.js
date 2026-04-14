import { addEventListener, DOM_EVENT } from '@cloudcare/browser-core'
import { takeAutoCanvasSnapshots } from './canvasAutoSnapshot'

var CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL = 120

function isContinuousCanvasRecordingEnabled(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling !== 'all'
  )
}

function getContinuousSnapshotCanvases(getCanvases, configuration) {
  return Array.prototype.slice.call(getCanvases()).filter(function (canvas) {
    if (!configuration.shouldRecordCanvas) {
      return true
    }
    return configuration.shouldRecordCanvas(canvas) !== false
  })
}

export function startContinuousCanvasSnapshotLoop(options) {
  var configuration = options.configuration
  var snapshotCanvas = options.snapshotCanvas
  var now = options.now || Date.now
  var getSerializedNodeId = options.getSerializedNodeId
  var onDebug = options.onDebug || function () {}
  var getVisibilityState =
    options.getVisibilityState ||
    function () {
      return document.visibilityState
    }
  var getCanvases =
    options.getCanvases ||
    function () {
      return document.querySelectorAll('canvas')
    }
  var addEventListenerImpl = options.addEventListenerImpl || addEventListener
  var requestAnimationFrameImpl =
    options.requestAnimationFrameImpl ||
    function (callback) {
      return window.requestAnimationFrame(callback)
    }
  var cancelAnimationFrameImpl =
    options.cancelAnimationFrameImpl ||
    function (frameId) {
      return window.cancelAnimationFrame(frameId)
    }

  var stopped = false
  var frameId
  var snapshotInProgress = false
  var visibilityChangeListener
  var generation = 0
  var pendingImmediateRunAfterReset = false
  var lastSuccessfulSnapshotAtByCanvas = new WeakMap()

  function notifyDebug(summary) {
    onDebug(summary)
  }

  function clearScheduledFrame() {
    if (frameId !== undefined) {
      cancelAnimationFrameImpl(frameId)
      frameId = undefined
    }
  }

  function scheduleNextFrame() {
    if (stopped || frameId !== undefined || getVisibilityState() === 'hidden') {
      return
    }
    frameId = requestAnimationFrameImpl(function () {
      frameId = undefined
      runSnapshots()
    })
  }

  function stop() {
    stopped = true
    if (visibilityChangeListener) {
      visibilityChangeListener.stop()
    }
    clearScheduledFrame()
  }

  function reset() {
    if (!isContinuousCanvasRecordingEnabled(configuration)) {
      return
    }
    generation += 1
    lastSuccessfulSnapshotAtByCanvas = new WeakMap()
    clearScheduledFrame()
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
      notifyDebug({
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
      return
    }

    var canvases = getContinuousSnapshotCanvases(getCanvases, configuration)
    if (!canvases.length) {
      notifyDebug({
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
      scheduleNextFrame()
      return
    }

    var startedAt = now()
    var selectedCanvases = canvases.filter(function (canvas) {
      var lastSuccessfulSnapshotAt = lastSuccessfulSnapshotAtByCanvas.get(canvas)
      return (
        lastSuccessfulSnapshotAt === undefined ||
        startedAt - lastSuccessfulSnapshotAt >= CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL
      )
    })
    if (!selectedCanvases.length) {
      notifyDebug({
        scheduler: 'continuous_snapshot',
        status: 'skipped_no_candidates',
        startedAt: startedAt,
        completedAt: now(),
        timestamp: now(),
        eligibleCanvasCount: canvases.length,
        selectedCanvasCount: 0,
        skippedBudgetCount: canvases.length,
        keepSessionAliveTriggered: false,
        results: []
      })
      scheduleNextFrame()
      return
    }
    var summary = {
      scheduler: 'continuous_snapshot',
      status: 'completed',
      startedAt: startedAt,
      eligibleCanvasCount: canvases.length,
      selectedCanvasCount: selectedCanvases.length,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: []
    }
    var runGeneration = generation
    snapshotInProgress = true

    takeAutoCanvasSnapshots(
      function () {
        return selectedCanvases
      },
      function (canvas) {
        if (runGeneration !== generation || getVisibilityState() === 'hidden') {
          return {
            ok: false,
            reason: 'skipped_hidden'
          }
        }
        var serializedNodeId = getSerializedNodeId
          ? getSerializedNodeId(canvas)
          : undefined
        return Promise.resolve(snapshotCanvas(canvas))
          .then(function (result) {
            if (runGeneration !== generation || getVisibilityState() === 'hidden') {
              return result
            }
            if (!result || result.ok !== false) {
              lastSuccessfulSnapshotAtByCanvas.set(canvas, now())
            }
            summary.results.push({
              canvasId: serializedNodeId,
              ok: !result || result.ok !== false,
              reason: result && result.ok === false ? result.reason : undefined,
              priority: undefined
            })
            return result
          })
          .catch(function () {
            var result = {
              ok: false,
              reason: 'encode_failed'
            }
            if (runGeneration !== generation || getVisibilityState() === 'hidden') {
              return result
            }
            summary.results.push({
              canvasId: serializedNodeId,
              ok: false,
              reason: result.reason,
              priority: undefined
            })
            return result
          })
      }
    ).then(
      function () {
        snapshotInProgress = false
        if (runGeneration !== generation) {
          if (pendingImmediateRunAfterReset) {
            pendingImmediateRunAfterReset = false
            scheduleNextFrame()
          }
          return
        }
        pendingImmediateRunAfterReset = false
        summary.completedAt = now()
        summary.timestamp = summary.completedAt
        notifyDebug(summary)
        scheduleNextFrame()
      },
      function () {
        snapshotInProgress = false
        if (runGeneration !== generation) {
          if (pendingImmediateRunAfterReset) {
            pendingImmediateRunAfterReset = false
            scheduleNextFrame()
          }
          return
        }
        pendingImmediateRunAfterReset = false
        summary.completedAt = now()
        summary.timestamp = summary.completedAt
        notifyDebug(summary)
        scheduleNextFrame()
      }
    )
  }

  if (!isContinuousCanvasRecordingEnabled(configuration)) {
    return {
      stop: stop,
      reset: reset
    }
  }

  scheduleNextFrame()

  visibilityChangeListener = addEventListenerImpl(
    window,
    DOM_EVENT.VISIBILITY_CHANGE,
    function () {
      if (getVisibilityState() !== 'hidden') {
        requestResumeAfterPause()
      } else {
        generation += 1
        lastSuccessfulSnapshotAtByCanvas = new WeakMap()
        pendingImmediateRunAfterReset = false
        clearScheduledFrame()
      }
    },
    { capture: true }
  )

  return {
    stop: stop,
    reset: reset
  }
}
