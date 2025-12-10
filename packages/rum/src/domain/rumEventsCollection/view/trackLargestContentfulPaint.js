import {
  addEventListeners,
  DOM_EVENT,
  findLast,
  LifeCycleEventType,
  ONE_MINUTE
} from '@cloudcare/browser-core'
import { getSelectorFromElement } from '../actions/getSelectorsFromElement'
import {
  RumPerformanceEntryType,
  createPerformanceObservable
} from '../../performanceObservable'
/**
 * Track the largest contentful paint (LCP) occurring during the initial View.  This can yield
 * multiple values, only the most recent one should be used.
 * Documentation: https://web.dev/lcp/
 * Reference implementation: https://github.com/GoogleChrome/web-vitals/blob/master/src/onLCP.ts
 */
// It happens in some cases like sleep mode or some browser implementations
export var LCP_MAXIMUM_DELAY = 10 * ONE_MINUTE
export function trackLargestContentfulPaint(
  configuration,
  firstHidden,
  eventTarget,
  callback
) {
  // Ignore entries that come after the first user interaction.  According to the documentation, the
  // browser should not send largest-contentful-paint entries after a user interact with the page,
  // but the web-vitals reference implementation uses this as a safeguard.
  var firstInteractionTimestamp = Infinity
  var _addEventListeners = addEventListeners(
    eventTarget,
    [DOM_EVENT.POINTER_DOWN, DOM_EVENT.KEY_DOWN],
    function (event) {
      firstInteractionTimestamp = event.timeStamp
    },
    { capture: true, once: true }
  )
  var stopEventListener = _addEventListeners.stop
  var biggestLcpSize = 0
  var performanceLcpSubscription = createPerformanceObservable(configuration, {
    type: RumPerformanceEntryType.LARGEST_CONTENTFUL_PAINT,
    buffered: true
  }).subscribe(function (entries) {
    var lcpEntry = findLast(entries, function (entry) {
      return (
        entry.entryType === RumPerformanceEntryType.LARGEST_CONTENTFUL_PAINT &&
        entry.startTime < firstInteractionTimestamp &&
        entry.startTime < firstHidden.getTimeStamp() &&
        entry.startTime < LCP_MAXIMUM_DELAY &&
        // Ensure to get the LCP entry with the biggest size, see
        // https://bugs.chromium.org/p/chromium/issues/detail?id=1516655
        entry.size > biggestLcpSize
      )
    })
    if (lcpEntry) {
      var lcpTargetSelector
      if (lcpEntry.element) {
        lcpTargetSelector = getSelectorFromElement(
          lcpEntry.element,
          configuration.actionNameAttribute
        )
      }
      callback({
        value: lcpEntry.startTime,
        targetSelector: lcpTargetSelector
      })
      biggestLcpSize = lcpEntry.size
    }
  })

  return {
    stop: function () {
      stopEventListener()
      performanceLcpSubscription.unsubscribe()
    }
  }
}
