import {
  addEventListener,
  clearTimeout,
  DOM_EVENT,
  setTimeout
} from '@cloudcare/browser-core'

function isAutoCanvasRecordingEnabled(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto'
  )
}

export function takeAutoCanvasSnapshots(getCanvases, snapshotCanvas) {
  var canvases = Array.prototype.slice.call(getCanvases())
  return canvases.reduce(function (chain, canvas) {
    return chain.then(function () {
      return Promise.resolve(snapshotCanvas(canvas)).catch(function () {})
    })
  }, Promise.resolve())
}

function isAutoSnapshotFailureReason(reason) {
  return (
    reason === 'encode_failed' ||
    reason === 'encode_too_large' ||
    reason === 'detached' ||
    reason === 'not_serialized'
  )
}

function getCanvasAutoPriority(configuration, canvas) {
  if (!configuration.shouldRecordCanvas) {
    return 0
  }

  var shouldRecordResult = configuration.shouldRecordCanvas(canvas)
  if (shouldRecordResult === false) {
    return null
  }

  return typeof shouldRecordResult === 'number' ? shouldRecordResult : 0
}

function compareAutoSnapshotEntries(a, b) {
  if (b.priority !== a.priority) {
    return b.priority - a.priority
  }

  if (
    a.lastSuccessfulSnapshotAt === undefined &&
    b.lastSuccessfulSnapshotAt !== undefined
  ) {
    return -1
  }
  if (
    b.lastSuccessfulSnapshotAt === undefined &&
    a.lastSuccessfulSnapshotAt !== undefined
  ) {
    return 1
  }
  if (a.lastSuccessfulSnapshotAt !== b.lastSuccessfulSnapshotAt) {
    return (a.lastSuccessfulSnapshotAt || 0) - (b.lastSuccessfulSnapshotAt || 0)
  }

  return a.index - b.index
}

export function createAutoCanvasSnapshotController(configuration, now) {
  var getNow = now || Date.now
  var nextEligibleAtByCanvas = new WeakMap()
  var lastSuccessfulSnapshotAtByCanvas = new WeakMap()

  return {
    shouldSnapshot: function (canvas) {
      return (nextEligibleAtByCanvas.get(canvas) || 0) <= getNow()
    },
    getDelayUntilNextSnapshot: function (canvas) {
      return Math.max((nextEligibleAtByCanvas.get(canvas) || 0) - getNow(), 0)
    },
    getLastSuccessfulSnapshotAt: function (canvas) {
      return lastSuccessfulSnapshotAtByCanvas.get(canvas)
    },
    updateAfterSnapshot: function (canvas, result) {
      var nowTime = getNow()
      if (!result || result.ok) {
        lastSuccessfulSnapshotAtByCanvas.set(canvas, nowTime)
        nextEligibleAtByCanvas.set(
          canvas,
          nowTime + configuration.replayCanvasAutoCooldown
        )
        return
      }
      if (result.reason === 'unchanged') {
        nextEligibleAtByCanvas.set(
          canvas,
          nowTime + configuration.replayCanvasAutoUnchangedBackoff
        )
        return
      }
      if (result.reason === 'below_threshold') {
        nextEligibleAtByCanvas.set(
          canvas,
          nowTime + configuration.replayCanvasAutoUnchangedBackoff
        )
        return
      }
      if (isAutoSnapshotFailureReason(result.reason)) {
        nextEligibleAtByCanvas.set(
          canvas,
          nowTime + configuration.replayCanvasAutoFailureBackoff
        )
        return
      }
      nextEligibleAtByCanvas.set(
        canvas,
        nowTime + configuration.replayCanvasAutoCooldown
      )
    }
  }
}

function collectAutoSnapshotEntries(getCanvases, controller, configuration) {
  return Array.prototype.slice
    .call(getCanvases())
    .map(function (canvas, index) {
      var priority = getCanvasAutoPriority(configuration, canvas)
      return {
        canvas: canvas,
        index: index,
        priority: priority,
        lastSuccessfulSnapshotAt: controller.getLastSuccessfulSnapshotAt(canvas),
        shouldSnapshot:
          priority !== null && controller.shouldSnapshot(canvas),
        nextSnapshotDelay:
          priority !== null
            ? controller.getDelayUntilNextSnapshot(canvas)
            : undefined
      }
    })
}

function getEligibleAutoSnapshotCanvases(entries) {
  return entries.filter(function (entry) {
    return entry.priority !== null && entry.shouldSnapshot
  })
}

function getNextAutoSnapshotDelay(entries, defaultDelay) {
  var nextDelay = entries.reduce(function (currentMin, entry) {
    if (
      entry.priority === null ||
      typeof entry.nextSnapshotDelay !== 'number' ||
      entry.shouldSnapshot
    ) {
      return currentMin
    }

    return currentMin === undefined
      ? entry.nextSnapshotDelay
      : Math.min(currentMin, entry.nextSnapshotDelay)
  }, undefined)

  return typeof nextDelay === 'number' ? nextDelay : defaultDelay
}

function pickAutoSnapshotCanvases(entries, maxPerRun, nextCanvasIndexByPriority) {
  var remaining =
    typeof maxPerRun === 'number' && maxPerRun > 0 ? maxPerRun : Infinity
  var pickedCanvases = []
  var groupedEntriesByPriority = {}

  entries
    .slice()
    .sort(compareAutoSnapshotEntries)
    .forEach(function (entry) {
      var key = String(entry.priority)
      if (!groupedEntriesByPriority[key]) {
        groupedEntriesByPriority[key] = []
      }
      groupedEntriesByPriority[key].push(entry)
    })

  Object.keys(groupedEntriesByPriority)
    .map(function (key) {
      return Number(key)
    })
    .sort(function (a, b) {
      return b - a
    })
    .some(function (priority) {
      if (!remaining) {
        return true
      }

      var key = String(priority)
      var entriesForPriority = groupedEntriesByPriority[key]
      var startIndex =
        (nextCanvasIndexByPriority[key] || 0) % entriesForPriority.length
      var rotatedEntries = entriesForPriority
        .slice(startIndex)
        .concat(entriesForPriority.slice(0, startIndex))
      var selectedEntries = rotatedEntries.slice(0, remaining)

      nextCanvasIndexByPriority[key] = startIndex + selectedEntries.length
      pickedCanvases = pickedCanvases.concat(
        selectedEntries.map(function (entry) {
          return entry.canvas
        })
      )
      remaining -= selectedEntries.length

      return remaining === 0
    })

  return pickedCanvases
}

export function startAutoCanvasSnapshotLoop(options) {
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
  var setTimeoutImpl = options.setTimeoutImpl || setTimeout
  var clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout
  var controller = createAutoCanvasSnapshotController(configuration, now)

  if (!isAutoCanvasRecordingEnabled(configuration)) {
    return function () {}
  }

  var stopped = false
  var snapshotInProgress = false
  var scheduledTimeoutId
  var nextCanvasIndexByPriority = {}

  function notifyDebug(summary) {
    onDebug(summary)
  }

  function clearScheduledRun() {
    if (scheduledTimeoutId !== undefined) {
      clearTimeoutImpl(scheduledTimeoutId)
      scheduledTimeoutId = undefined
    }
  }

  function scheduleNextRun(delay) {
    if (stopped || getVisibilityState() === 'hidden') {
      return
    }

    clearScheduledRun()
    scheduledTimeoutId = setTimeoutImpl(function () {
      scheduledTimeoutId = undefined
      runSnapshots()
    }, Math.max(delay, 0))
  }

  function scheduleNextRunForCurrentState() {
    var entries = collectAutoSnapshotEntries(
      getCanvases,
      controller,
      configuration
    )

    if (getEligibleAutoSnapshotCanvases(entries).length) {
      scheduleNextRun(configuration.replayCanvasAutoInterval)
      return
    }

    scheduleNextRun(
      getNextAutoSnapshotDelay(entries, configuration.replayCanvasAutoInterval)
    )
  }

  function runSnapshots() {
    if (stopped || snapshotInProgress) {
      return
    }
    if (getVisibilityState() === 'hidden') {
      clearScheduledRun()
      notifyDebug({
        status: 'skipped_hidden',
        timestamp: now(),
        eligibleCanvasCount: 0,
        selectedCanvasCount: 0,
        skippedBudgetCount: 0,
        results: []
      })
      return
    }
    var entries = collectAutoSnapshotEntries(
      getCanvases,
      controller,
      configuration
    )
    var eligibleCanvases = getEligibleAutoSnapshotCanvases(entries)
    var canvases = pickAutoSnapshotCanvases(
      eligibleCanvases,
      configuration.replayCanvasAutoMaxPerRun,
      nextCanvasIndexByPriority
    )
    if (!canvases.length) {
      scheduleNextRun(
        getNextAutoSnapshotDelay(entries, configuration.replayCanvasAutoInterval)
      )
      notifyDebug({
        status: 'skipped_no_candidates',
        timestamp: now(),
        eligibleCanvasCount: eligibleCanvases.length,
        selectedCanvasCount: 0,
        skippedBudgetCount: 0,
        results: []
      })
      return
    }
    var summary = {
      status: 'completed',
      timestamp: now(),
      eligibleCanvasCount: eligibleCanvases.length,
      selectedCanvasCount: canvases.length,
      skippedBudgetCount: Math.max(eligibleCanvases.length - canvases.length, 0),
      results: []
    }
    snapshotInProgress = true
    takeAutoCanvasSnapshots(
      function () {
        return canvases
      },
      function (canvas) {
        var serializedNodeId = getSerializedNodeId
          ? getSerializedNodeId(canvas)
          : undefined
        return Promise.resolve(snapshotCanvas(canvas))
          .then(function (result) {
            controller.updateAfterSnapshot(canvas, result)
            summary.results.push({
              canvasId: serializedNodeId,
              ok: !result || result.ok !== false,
              reason: result && result.ok === false ? result.reason : undefined,
              priority: getCanvasAutoPriority(configuration, canvas)
            })
            return result
          })
          .catch(function () {
            var result = {
              ok: false,
              reason: 'encode_failed'
            }
            controller.updateAfterSnapshot(canvas, result)
            summary.results.push({
              canvasId: serializedNodeId,
              ok: false,
              reason: result.reason,
              priority: getCanvasAutoPriority(configuration, canvas)
            })
            return result
          })
      }
    ).then(
      function () {
        snapshotInProgress = false
        scheduleNextRunForCurrentState()
        notifyDebug(summary)
      },
      function () {
        snapshotInProgress = false
        scheduleNextRunForCurrentState()
        notifyDebug(summary)
      }
    )
  }

  runSnapshots()

  var visibilityChangeListener = addEventListenerImpl(
    window,
    DOM_EVENT.VISIBILITY_CHANGE,
    function () {
      if (getVisibilityState() !== 'hidden') {
        runSnapshots()
      } else {
        clearScheduledRun()
      }
    },
    { capture: true }
  )

  return function () {
    stopped = true
    visibilityChangeListener.stop()
    clearScheduledRun()
  }
}
