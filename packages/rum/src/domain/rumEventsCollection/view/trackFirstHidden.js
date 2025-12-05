import { DOM_EVENT, addEventListeners, noop } from '@cloudcare/browser-core'
import {
  supportPerformanceTimingEvent,
  RumPerformanceEntryType
} from '../../../domain/performanceObservable.js'
export function trackFirstHidden(viewStart, eventTarget) {
  if (typeof eventTarget === 'undefined') {
    eventTarget = window
  }
  if (document.visibilityState === 'hidden' && !document.prerendering) {
    return { getTimeStamp: () => 0, stop: noop }
  }
  if (
    supportPerformanceTimingEvent(RumPerformanceEntryType.VISIBILITY_STATE) &&
    !document.prerendering
  ) {
    const firstHiddenEntry = performance
      .getEntriesByType(RumPerformanceEntryType.VISIBILITY_STATE)
      .filter((entry) => entry.name === 'hidden')
      .find((entry) => entry.startTime >= viewStart.relative)
    if (firstHiddenEntry) {
      return { getTimeStamp: () => firstHiddenEntry.startTime, stop: noop }
    }
  }
  let timeStamp = Infinity

  const { stop } = addEventListeners(
    eventTarget,
    [
      DOM_EVENT.PAGE_HIDE,
      DOM_EVENT.VISIBILITY_CHANGE,
      DOM_EVENT.PRERENDERING_CHANGE
    ],
    (event) => {
      if (
        event.type === DOM_EVENT.PAGE_HIDE ||
        document.visibilityState === 'hidden'
      ) {
        timeStamp = event.timeStamp
        stop()
      }
    },
    { capture: true }
  )

  return {
    getTimeStamp: function () {
      return timeStamp
    },
    stop: function () {
      stop()
    }
  }
}
