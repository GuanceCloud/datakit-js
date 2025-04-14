import { elapsed, find, isElementNode } from '@cloudcare/browser-core'
import { getSelectorFromElement } from '../actions/getSelectorsFromElement'
import {
  RumPerformanceEntryType,
  createPerformanceObservable
} from '../../performanceObservable'
/**
 * Track the first input occurring during the initial View to return:
 * - First Input Delay
 * - First Input Time
 * Callback is called at most one time.
 * Documentation: https://web.dev/fid/
 * Reference implementation: https://github.com/GoogleChrome/web-vitals/blob/master/src/getFID.ts
 */
export function trackFirstInput(configuration, firstHidden, callback) {
  const performanceFirstInputSubscription = createPerformanceObservable(
    configuration,
    {
      type: RumPerformanceEntryType.FIRST_INPUT,
      buffered: true
    }
  ).subscribe(function (entries) {
    var firstInputEntry = find(entries, function (entry) {
      return (
        entry.entryType === RumPerformanceEntryType.FIRST_INPUT &&
        entry.startTime < firstHidden.getTimeStamp()
      )
    })
    if (firstInputEntry) {
      var firstInputDelay = elapsed(
        firstInputEntry.startTime,
        firstInputEntry.processingStart
      )
      var firstInputTargetSelector
      if (firstInputEntry.target && isElementNode(firstInputEntry.target)) {
        firstInputTargetSelector = getSelectorFromElement(
          firstInputEntry.target,
          configuration.actionNameAttribute
        )
      }
      callback({
        // Ensure firstInputDelay to be positive, see
        // https://bugs.chromium.org/p/chromium/issues/detail?id=1185815
        delay: firstInputDelay >= 0 ? firstInputDelay : 0,
        time: firstInputEntry.startTime,
        targetSelector: firstInputTargetSelector
      })
    }
  })
  return {
    stop: function () {
      performanceFirstInputSubscription.unsubscribe()
    }
  }
}
