import { monitor, noop } from '@cloudcare/browser-core'
import { supportPerformanceTimingEvent } from '../../performanceObservable'

var SOFT_NAVIGATION = 'soft-navigation'

export function trackSoftNavigationMetrics(callback) {
  if (!supportPerformanceTimingEvent(SOFT_NAVIGATION)) {
    return noop
  }

  // Reuse one observer for both final API entry types to keep this optional
  // Chrome-only enhancement small.
  var observer = new window.PerformanceObserver(
    monitor(function (entries) {
      entries.getEntries().forEach(callback)
    })
  )
  try {
    observer.observe({
      type: SOFT_NAVIGATION,
      buffered: true
    })
    observer.observe({
      type: 'interaction-contentful-paint',
      buffered: true
    })
  } catch {
    observer.disconnect()
    return noop
  }

  return function () {
    observer.disconnect()
  }
}
