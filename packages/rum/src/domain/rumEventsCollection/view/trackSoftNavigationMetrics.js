import { monitor, noop } from '@cloudcare/browser-core'

var SOFT_NAVIGATION = 'soft-navigation'

export function trackSoftNavigationMetrics(callback) {
  if (!window.PerformanceObserver) {
    return noop
  }

  // Reuse one observer for both final API entry types to keep this optional
  // Chrome-only enhancement small.
  var observer
  try {
    observer = new window.PerformanceObserver(
      monitor(function (entries) {
        entries.getEntries().forEach(callback)
      })
    )
    observer.observe({
      type: SOFT_NAVIGATION,
      buffered: true
    })
  } catch {
    if (observer) {
      observer.disconnect()
    }
    return noop
  }
  try {
    observer.observe({
      type: 'interaction-contentful-paint',
      buffered: true
    })
  } catch {
    // Keep FCP and navigation type when an implementation exposes soft
    // navigations before interaction contentful paint.
  }

  return function () {
    observer.disconnect()
  }
}
