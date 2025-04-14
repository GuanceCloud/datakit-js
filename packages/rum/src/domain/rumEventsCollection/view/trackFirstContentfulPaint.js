import { find, ONE_MINUTE } from '@cloudcare/browser-core'
import {
  RumPerformanceEntryType,
  createPerformanceObservable
} from '../../performanceObservable'
export var TIMING_MAXIMUM_DELAY = 10 * ONE_MINUTE
export function trackFirstContentfulPaint(
  configuration,
  firstHidden,
  callback
) {
  var performanceSubscription = createPerformanceObservable(configuration, {
    type: RumPerformanceEntryType.PAINT,
    buffered: true
  }).subscribe(function (entries) {
    var fcpEntry = find(entries, function (entry) {
      return (
        entry.entryType === RumPerformanceEntryType.PAINT &&
        entry.name === 'first-contentful-paint' &&
        entry.startTime < firstHidden.getTimeStamp() &&
        entry.startTime < TIMING_MAXIMUM_DELAY
      )
    })
    if (fcpEntry) {
      callback(fcpEntry.startTime)
    }
  })
  return { stop: performanceSubscription.unsubscribe }
}
