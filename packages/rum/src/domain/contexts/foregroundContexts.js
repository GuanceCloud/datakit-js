import {
  addDuration,
  addEventListener,
  DOM_EVENT,
  elapsed,
  relativeNow,
  toServerDuration
} from '@cloudcare/browser-core'

// Arbitrary value to cap number of element mostly for backend & to save bandwidth
export var MAX_NUMBER_OF_SELECTABLE_FOREGROUND_PERIODS = 500
// Arbitrary value to cap number of element mostly for memory consumption in the browser
export var MAX_NUMBER_OF_STORED_FOREGROUND_PERIODS = 2500

var foregroundPeriods = []

export function startForegroundContexts() {
  if (document.hasFocus()) {
    addNewForegroundPeriod()
  }

  var foregroundTracking = trackFocus(addNewForegroundPeriod)
  var blurTracking = trackBlur(closeForegroundPeriod)
  return {
    isInForegroundAt: isInForegroundAt,
    selectInForegroundPeriodsFor: selectInForegroundPeriodsFor,
    stop: function () {
      foregroundPeriods = []
      foregroundTracking.stop()
      blurTracking.stop()
    }
  }
}

export function addNewForegroundPeriod() {
  if (foregroundPeriods.length > MAX_NUMBER_OF_STORED_FOREGROUND_PERIODS) {
    return
  }
  var currentForegroundPeriod = foregroundPeriods[foregroundPeriods.length - 1]
  var now = relativeNow()
  if (
    currentForegroundPeriod !== undefined &&
    currentForegroundPeriod.end === undefined
  ) {
    return
  }
  foregroundPeriods.push({
    start: now
  })
}

export function closeForegroundPeriod() {
  if (foregroundPeriods.length === 0) {
    return
  }
  var currentForegroundPeriod = foregroundPeriods[foregroundPeriods.length - 1]
  var now = relativeNow()
  if (currentForegroundPeriod.end !== undefined) {
    return
  }
  currentForegroundPeriod.end = now
}

function trackFocus(onFocusChange) {
  return addEventListener(window, DOM_EVENT.FOCUS, function (event) {
    if (!event.isTrusted) {
      return
    }
    onFocusChange()
  })
}

function trackBlur(onBlurChange) {
  return addEventListener(window, DOM_EVENT.BLUR, function (event) {
    if (!event.isTrusted) {
      return
    }
    onBlurChange()
  })
}

function isInForegroundAt(startTime) {
  for (var i = foregroundPeriods.length - 1; i >= 0; i--) {
    var foregroundPeriod = foregroundPeriods[i]
    if (
      foregroundPeriod.end !== undefined &&
      startTime > foregroundPeriod.end
    ) {
      break
    }
    if (
      startTime > foregroundPeriod.start &&
      (foregroundPeriod.end === undefined || startTime < foregroundPeriod.end)
    ) {
      return true
    }
  }
  return false
}

function selectInForegroundPeriodsFor(eventStartTime, duration) {
  var eventEndTime = addDuration(eventStartTime, duration)
  var filteredForegroundPeriods = []

  var earliestIndex = Math.max(
    0,
    foregroundPeriods.length - MAX_NUMBER_OF_SELECTABLE_FOREGROUND_PERIODS
  )
  for (var i = foregroundPeriods.length - 1; i >= earliestIndex; i--) {
    var foregroundPeriod = foregroundPeriods[i]
    if (
      foregroundPeriod.end !== undefined &&
      eventStartTime > foregroundPeriod.end
    ) {
      // event starts after the end of the current focus period
      // since the array is sorted, we can stop looking for foreground periods
      break
    }
    if (eventEndTime < foregroundPeriod.start) {
      // event ends before the start of the current focus period
      // continue to previous one
      continue
    }
    var startTime =
      eventStartTime > foregroundPeriod.start
        ? eventStartTime
        : foregroundPeriod.start
    var startDuration = elapsed(eventStartTime, startTime)
    var endTime =
      foregroundPeriod.end === undefined || eventEndTime < foregroundPeriod.end
        ? eventEndTime
        : foregroundPeriod.end
    var endDuration = elapsed(startTime, endTime)
    filteredForegroundPeriods.unshift({
      start: toServerDuration(startDuration),
      duration: toServerDuration(endDuration)
    })
  }
  return filteredForegroundPeriods
}
