import {
  noop,
  ViewLoadingType,
  ONE_MINUTE,
  elapsed,
  isElementNode
} from '@cloudcare/browser-core'
import { getSelectorFromElement } from '../actions/getSelectorsFromElement'
import {
  getInteractionCount,
  initInteractionCountPolyfill
} from './interactionCountPolyfill'
import {
  RumPerformanceEntryType,
  supportPerformanceTimingEvent,
  createPerformanceObservable
} from '../../performanceObservable'
import { getInteractionSelector } from '../actions/interactionSelectorCache'
// Arbitrary value to prevent unnecessary memory usage on views with lots of interactions.
var MAX_INTERACTION_ENTRIES = 10

export var MAX_INP_VALUE = 1 * ONE_MINUTE

/**
 * Track the interaction to next paint (INP).
 * To avoid outliers, return the p98 worst interaction of the view.
 * Documentation: https://web.dev/inp/
 * Reference implementation: https://github.com/GoogleChrome/web-vitals/blob/main/src/onINP.ts
 */
export function trackInteractionToNextPaint(
  configuration,
  viewStart,
  viewLoadingType
) {
  if (!isInteractionToNextPaintSupported()) {
    return {
      getInteractionToNextPaint: function () {
        return undefined
      },
      setViewEnd: noop,
      stop: noop
    }
  }

  var _trackViewInteractionCount = trackViewInteractionCount(viewLoadingType)
  var getViewInteractionCount =
    _trackViewInteractionCount.getViewInteractionCount
  var stopViewInteractionCount =
    _trackViewInteractionCount.stopViewInteractionCount

  let viewEnd = Infinity
  var longestInteractions = trackLongestInteractions(getViewInteractionCount)
  var interactionToNextPaint = -1
  var interactionToNextPaintTargetSelector
  var interactionToNextPaintStartTime
  function handleEntries(entries) {
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
      var entry = entries_1[_i]
      if (
        entry.interactionId &&
        entry.startTime >= viewStart &&
        entry.startTime <= viewEnd
      ) {
        longestInteractions.process(entry)
      }
    }

    var newInteraction = longestInteractions.estimateP98Interaction()
    if (newInteraction && newInteraction.duration !== interactionToNextPaint) {
      interactionToNextPaint = newInteraction.duration
      interactionToNextPaintStartTime = elapsed(
        viewStart,
        newInteraction.startTime
      )
      interactionToNextPaintTargetSelector = getInteractionSelector(
        newInteraction.startTime
      )
      if (
        !interactionToNextPaintTargetSelector &&
        newInteraction.target &&
        isElementNode(newInteraction.target)
      ) {
        interactionToNextPaintTargetSelector = getSelectorFromElement(
          newInteraction.target,
          configuration.actionNameAttribute
        )
      }
    }
  }
  var firstInputSubscription = createPerformanceObservable(configuration, {
    type: RumPerformanceEntryType.FIRST_INPUT,
    buffered: true
  }).subscribe(handleEntries)

  var eventSubscription = createPerformanceObservable(configuration, {
    type: RumPerformanceEntryType.EVENT,
    // durationThreshold only impact PerformanceEventTiming entries used for INP computation which requires a threshold at 40 (default is 104ms)
    // cf: https://github.com/GoogleChrome/web-vitals/blob/3806160ffbc93c3c4abf210a167b81228172b31c/src/onINP.ts#L202-L210
    durationThreshold: 40,
    buffered: true
  }).subscribe(handleEntries)

  return {
    getInteractionToNextPaint: function () {
      // If no INP duration where captured because of the performanceObserver 40ms threshold
      // but the view interaction count > 0 then report 0
      if (interactionToNextPaint >= 0) {
        return {
          value: Math.min(interactionToNextPaint, MAX_INP_VALUE),
          targetSelector: interactionToNextPaintTargetSelector,
          time: interactionToNextPaintStartTime
        }
      } else if (getViewInteractionCount()) {
        return {
          value: 0
        }
      }
    },
    setViewEnd: function (viewEndTime) {
      viewEnd = viewEndTime
      stopViewInteractionCount()
    },
    stop: function () {
      eventSubscription.unsubscribe()
      firstInputSubscription.unsubscribe()
    }
  }
}

function trackLongestInteractions(getViewInteractionCount) {
  var longestInteractions = []

  function sortAndTrimLongestInteractions() {
    longestInteractions
      .sort(function (a, b) {
        return b.duration - a.duration
      })
      .splice(MAX_INTERACTION_ENTRIES)
  }

  return {
    /**
     * Process the performance entry:
     * - if its duration is long enough, add the performance entry to the list of worst interactions
     * - if an entry with the same interaction id exists and its duration is lower than the new one, then replace it in the list of worst interactions
     */
    process: function (entry) {
      var interactionIndex = longestInteractions.findIndex(function (
        interaction
      ) {
        return entry.interactionId === interaction.interactionId
      })

      var minLongestInteraction =
        longestInteractions[longestInteractions.length - 1]

      if (interactionIndex !== -1) {
        if (entry.duration > longestInteractions[interactionIndex].duration) {
          longestInteractions[interactionIndex] = entry
          sortAndTrimLongestInteractions()
        }
      } else if (
        longestInteractions.length < MAX_INTERACTION_ENTRIES ||
        entry.duration > minLongestInteraction.duration
      ) {
        longestInteractions.push(entry)
        sortAndTrimLongestInteractions()
      }
    },
    /**
     * Compute the p98 longest interaction.
     * For better performance the computation is based on 10 longest interactions and the interaction count of the current view.
     */
    estimateP98Interaction: function () {
      var interactionIndex = Math.min(
        longestInteractions.length - 1,
        Math.floor(getViewInteractionCount() / 50)
      )
      return longestInteractions[interactionIndex]
    }
  }
}

export function trackViewInteractionCount(viewLoadingType) {
  initInteractionCountPolyfill()
  var previousInteractionCount =
    viewLoadingType === ViewLoadingType.INITIAL_LOAD ? 0 : getInteractionCount()
  var state = { stopped: false }

  function computeViewInteractionCount() {
    return getInteractionCount() - previousInteractionCount
  }
  return {
    getViewInteractionCount: function () {
      if (state.stopped) {
        return state.interactionCount
      }
      return computeViewInteractionCount()
    },
    stopViewInteractionCount: function () {
      state = {
        stopped: true,
        interactionCount: computeViewInteractionCount()
      }
    }
  }
}

export function isInteractionToNextPaintSupported() {
  return (
    supportPerformanceTimingEvent('event') &&
    window.PerformanceEventTiming &&
    'interactionId' in PerformanceEventTiming.prototype
  )
}
