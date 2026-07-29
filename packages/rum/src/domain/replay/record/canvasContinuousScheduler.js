import { addEventListener, DOM_EVENT } from '@cloudcare/browser-core'
import {
  getReplayCanvasRecordingDecision,
  isWebGLReplayCanvas
} from './canvasContext'

var CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL = 120
var MAX_CONTINUOUS_CANVAS_SNAPSHOTS_PER_RUN = 8
var MAX_CONTINUOUS_CANVAS_CONCURRENCY = 4
var MAX_CONTINUOUS_CANVAS_SCAN_PER_RUN = 64

function isContinuousCanvasRecordingEnabled(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling !== 'all'
  )
}

function clampInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), minimum), maximum)
}

function scanContinuousSnapshotCanvases(getCanvases, scanCursor) {
  var canvasCollection = getCanvases(MAX_CONTINUOUS_CANVAS_SCAN_PER_RUN)
  var canvasCount =
    canvasCollection && typeof canvasCollection.length === 'number'
      ? canvasCollection.length
      : 0
  if (!canvasCount) {
    return {
      canvases: [],
      nextScanCursor: 0
    }
  }

  var scannedCanvasCount = Math.min(
    canvasCount,
    MAX_CONTINUOUS_CANVAS_SCAN_PER_RUN
  )
  var canvases = []
  for (var offset = 0; offset < scannedCanvasCount; offset += 1) {
    var canvas = canvasCollection[(scanCursor + offset) % canvasCount]
    if (canvas && !isWebGLReplayCanvas(canvas)) {
      canvases.push(canvas)
    }
  }
  return {
    canvases: canvases,
    nextScanCursor: (scanCursor + scannedCanvasCount) % canvasCount
  }
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

function getSnapshotBackoff(configuration, result) {
  if (!result || result.ok !== false) {
    return (
      configuration.replayCanvasAutoCooldown ||
      CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL
    )
  }
  if (result.reason === 'unchanged' || result.reason === 'below_threshold') {
    return (
      configuration.replayCanvasAutoUnchangedBackoff ||
      configuration.replayCanvasAutoCooldown ||
      CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL
    )
  }
  return (
    configuration.replayCanvasAutoFailureBackoff ||
    configuration.replayCanvasAutoCooldown ||
    CONTINUOUS_CANVAS_MIN_SUCCESS_INTERVAL
  )
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
  var setTimeoutImpl =
    options.setTimeoutImpl ||
    function (callback, delay) {
      return window.setTimeout(callback, delay)
    }
  var clearTimeoutImpl =
    options.clearTimeoutImpl ||
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

  function notifyDebug(summary) {
    onDebug(summary)
  }

  function clearScheduledFrame() {
    if (frameId !== undefined) {
      cancelAnimationFrameImpl(frameId)
      frameId = undefined
    }
  }

  function clearScheduledTimeout() {
    if (timeoutId !== undefined) {
      clearTimeoutImpl(timeoutId)
      timeoutId = undefined
    }
  }

  function clearScheduledWork() {
    clearScheduledFrame()
    clearScheduledTimeout()
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

  function reset() {
    if (!isContinuousCanvasRecordingEnabled(configuration)) {
      return
    }
    generation += 1
    lastSnapshotAttemptOrderByCanvas = new WeakMap()
    snapshotAttemptOrder = 0
    nextEligibleAtByCanvas = new WeakMap()
    nextCanvasScanAt = 0
    continuousCanvasScanCursor = 0
    clearScheduledWork()
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

    var startedAt = now()
    if (startedAt < nextCanvasScanAt) {
      scheduleNextFrame()
      return
    }
    nextCanvasScanAt =
      startedAt + (configuration.replayCanvasAutoInterval || 0)

    var scanResult = scanContinuousSnapshotCanvases(
      getCanvases,
      continuousCanvasScanCursor
    )
    continuousCanvasScanCursor = scanResult.nextScanCursor
    var priorityByCanvas = new Map()
    var canvases = scanResult.canvases.filter(function (canvas) {
      var result = getReplayCanvasRecordingDecision(
        configuration,
        canvas
      )
      if (result === false) {
        return false
      }
      priorityByCanvas.set(
        canvas,
        typeof result === 'number' ? result : 0
      )
      return true
    })
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

    var eligibleCanvases = canvases
      .filter(function (canvas) {
        return (nextEligibleAtByCanvas.get(canvas) || 0) <= startedAt
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
      notifyDebug({
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
      scheduleNextFrame()
      return
    }
    selectedCanvases.forEach(function (canvas) {
      snapshotAttemptOrder += 1
      lastSnapshotAttemptOrderByCanvas.set(canvas, snapshotAttemptOrder)
    })
    var summary = {
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
    var runGeneration = generation
    snapshotInProgress = true

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
        var serializedNodeId = getSerializedNodeId
          ? getSerializedNodeId(canvas)
          : undefined
        return Promise.resolve(snapshotCanvas(canvas))
          .then(function (result) {
            if (runGeneration !== generation || getVisibilityState() === 'hidden') {
              return result
            }
            nextEligibleAtByCanvas.set(
              canvas,
              now() + getSnapshotBackoff(configuration, result)
            )
            summary.results.push({
              canvasId: serializedNodeId,
              ok: !result || result.ok !== false,
              reason: result && result.ok === false ? result.reason : undefined,
              priority: priorityByCanvas.get(canvas)
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
            nextEligibleAtByCanvas.set(
              canvas,
              now() + getSnapshotBackoff(configuration, result)
            )
            summary.results.push({
              canvasId: serializedNodeId,
              ok: false,
              reason: result.reason,
              priority: priorityByCanvas.get(canvas)
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
    document,
    DOM_EVENT.VISIBILITY_CHANGE,
    function () {
      if (getVisibilityState() !== 'hidden') {
        requestResumeAfterPause()
      } else {
        generation += 1
        lastSnapshotAttemptOrderByCanvas = new WeakMap()
        snapshotAttemptOrder = 0
        nextEligibleAtByCanvas = new WeakMap()
        nextCanvasScanAt = 0
        continuousCanvasScanCursor = 0
        pendingImmediateRunAfterReset = false
        clearScheduledWork()
      }
    },
    { capture: true }
  )

  return {
    stop: stop,
    reset: reset
  }
}
