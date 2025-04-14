import { getRelativeTime, isNumber, assign } from '@cloudcare/browser-core'
import {
  supportPerformanceTimingEvent,
  RumPerformanceEntryType
} from './performanceObservable'

export function getNavigationEntry() {
  if (supportPerformanceTimingEvent(RumPerformanceEntryType.NAVIGATION)) {
    var navigationEntry = performance.getEntriesByType(
      RumPerformanceEntryType.NAVIGATION
    )[0]
    if (navigationEntry) {
      return navigationEntry
    }
  }

  var timings = computeTimingsFromDeprecatedPerformanceTiming()
  var entry = assign(
    {
      entryType: RumPerformanceEntryType.NAVIGATION,
      initiatorType: 'navigation',
      name: window.location.href,
      startTime: 0,
      duration: timings.responseEnd,
      decodedBodySize: 0,
      encodedBodySize: 0,
      transferSize: 0,
      toJSON: function () {
        return assign({}, entry, { toJSON: undefined })
      }
    },
    timings
  )
  return entry
}

export function computeTimingsFromDeprecatedPerformanceTiming() {
  var result = {}
  var timing = performance.timing

  for (var key in timing) {
    if (isNumber(timing[key])) {
      var numberKey = key
      var timingElement = timing[numberKey]
      result[numberKey] =
        timingElement === 0 ? 0 : getRelativeTime(timingElement)
    }
  }
  return result
}
