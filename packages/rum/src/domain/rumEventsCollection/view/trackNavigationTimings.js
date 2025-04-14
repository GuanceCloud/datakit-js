import {
  relativeNow,
  setTimeout,
  runOnReadyState,
  clearTimeout
} from '@cloudcare/browser-core'

import { getNavigationEntry } from '../../performanceUtils'
export function trackNavigationTimings(
  configuration,
  callback,
  getNavigationEntryImpl
) {
  if (getNavigationEntryImpl === undefined) {
    getNavigationEntryImpl = getNavigationEntry
  }
  return waitAfterLoadEvent(function () {
    var entry = getNavigationEntryImpl()

    if (!isIncompleteNavigation(entry)) {
      callback(processNavigationEntry(entry))
    }
  })
}

function processNavigationEntry(entry) {
  return {
    fetchStart: entry.fetchStart,
    responseEnd: entry.responseEnd,
    domComplete: entry.domComplete,
    domContentLoaded: entry.domContentLoadedEventEnd,
    domInteractive: entry.domInteractive,
    loadEvent: entry.loadEventEnd,
    loadEventEnd: entry.loadEventEnd,
    loadEventStart: entry.loadEventStart,
    domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
    domContentLoadedEventStart: entry.domContentLoadedEventStart,
    // In some cases the value reported is negative or is larger
    // than the current page time. Ignore these cases:
    // https://github.com/GoogleChrome/web-vitals/issues/137
    // https://github.com/GoogleChrome/web-vitals/issues/162
    firstByte:
      entry.responseStart >= 0 && entry.responseStart <= relativeNow()
        ? entry.responseStart
        : undefined
  }
}

function isIncompleteNavigation(entry) {
  return entry.loadEventEnd <= 0
}

function waitAfterLoadEvent(callback) {
  var timeoutId
  var _runOnReadyState = runOnReadyState('complete', function () {
    // Invoke the callback a bit after the actual load event, so the "loadEventEnd" timing is accurate
    timeoutId = setTimeout(function () {
      callback()
    })
  })
  return {
    stop: function () {
      _runOnReadyState.stop()
      clearTimeout(timeoutId)
    }
  }
}
