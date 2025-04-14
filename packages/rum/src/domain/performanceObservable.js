import {
  addEventListener,
  Observable,
  setTimeout,
  clearTimeout,
  monitor,
  includes
} from '@cloudcare/browser-core'
import {
  isAllowedRequestUrl,
  hasValidResourceEntryDuration
} from './rumEventsCollection/resource/resourceUtils'
import { retrieveFirstInputTiming } from './firstInputPolyfill'
// We want to use a real enum (i.e. not a const enum) here, to be able to check whether an arbitrary
// string is an expected performance entry
// eslint-disable-next-line no-restricted-syntax
export var RumPerformanceEntryType = {
  EVENT: 'event',
  FIRST_INPUT: 'first-input',
  LARGEST_CONTENTFUL_PAINT: 'largest-contentful-paint',
  LAYOUT_SHIFT: 'layout-shift',
  LONG_TASK: 'longtask',
  LONG_ANIMATION_FRAME: 'long-animation-frame',
  NAVIGATION: 'navigation',
  PAINT: 'paint',
  RESOURCE: 'resource',
  VISIBILITY_STATE: 'visibility-state'
}

export function createPerformanceObservable(configuration, options) {
  return new Observable(function (observable) {
    if (!window.PerformanceObserver) {
      return
    }
    var handlePerformanceEntries = function (entries) {
      var rumPerformanceEntries = filterRumPerformanceEntries(
        configuration,
        entries
      )
      if (rumPerformanceEntries.length > 0) {
        observable.notify(rumPerformanceEntries)
      }
    }

    var timeoutId
    var isObserverInitializing = true

    const observer = new PerformanceObserver(
      monitor(function (entries) {
        // In Safari the performance observer callback is synchronous.
        // Because the buffered performance entry list can be quite large we delay the computation to prevent the SDK from blocking the main thread on init
        if (isObserverInitializing) {
          timeoutId = setTimeout(function () {
            handlePerformanceEntries(entries.getEntries())
          })
        } else {
          handlePerformanceEntries(entries.getEntries())
        }
      })
    )

    try {
      observer.observe(options)
    } catch {
      // Some old browser versions (<= chrome 74 ) don't support the PerformanceObserver type and buffered options
      // In these cases, fallback to getEntriesByType and PerformanceObserver with entryTypes
      // TODO: remove this fallback in the next major version
      var fallbackSupportedEntryTypes = [
        RumPerformanceEntryType.RESOURCE,
        RumPerformanceEntryType.NAVIGATION,
        RumPerformanceEntryType.LONG_TASK,
        RumPerformanceEntryType.PAINT
      ]
      if (includes(fallbackSupportedEntryTypes, options.type)) {
        if (options.buffered) {
          timeoutId = setTimeout(function () {
            handlePerformanceEntries(performance.getEntriesByType(options.type))
          })
        }
        try {
          observer.observe({ entryTypes: [options.type] })
        } catch {
          // Old versions of Safari are throwing "entryTypes contained only unsupported types"
          // errors when observing only unsupported entry types.
          //
          // We could use `supportPerformanceTimingEvent` to make sure we don't invoke
          // `observer.observe` with an unsupported entry type, but Safari 11 and 12 don't support
          // `Performance.supportedEntryTypes`, so doing so would lose support for these versions
          // even if they do support the entry type.
          return
        }
      }
    }
    isObserverInitializing = false

    manageResourceTimingBufferFull(configuration)
    var stopFirstInputTiming
    if (
      !supportPerformanceTimingEvent(RumPerformanceEntryType.FIRST_INPUT) &&
      options.type === RumPerformanceEntryType.FIRST_INPUT
    ) {
      var _retrieveFirstInputTiming = retrieveFirstInputTiming(
        configuration,
        function (timing) {
          handlePerformanceEntries([timing])
        }
      )
      stopFirstInputTiming = _retrieveFirstInputTiming.stop
    }
    return function () {
      observer.disconnect()
      if (stopFirstInputTiming) {
        stopFirstInputTiming()
      }
      clearTimeout(timeoutId)
    }
  })
}

var resourceTimingBufferFullListener
function manageResourceTimingBufferFull(configuration) {
  if (
    !resourceTimingBufferFullListener &&
    supportPerformanceObject() &&
    'addEventListener' in performance
  ) {
    // https://bugzilla.mozilla.org/show_bug.cgi?id=1559377
    resourceTimingBufferFullListener = addEventListener(
      performance,
      'resourcetimingbufferfull',
      function () {
        performance.clearResourceTimings()
      }
    )
  }
  return function () {
    resourceTimingBufferFullListener && resourceTimingBufferFullListener.stop()
  }
}

function supportPerformanceObject() {
  return window.performance !== undefined && 'getEntries' in performance
}

export function supportPerformanceTimingEvent(entryType) {
  return (
    window.PerformanceObserver &&
    PerformanceObserver.supportedEntryTypes !== undefined &&
    PerformanceObserver.supportedEntryTypes.includes(entryType)
  )
}

function filterRumPerformanceEntries(configuration, entries) {
  return entries.filter(function (entry) {
    return !isForbiddenResource(configuration, entry)
  })
}

function isForbiddenResource(configuration, entry) {
  return (
    entry.entryType === RumPerformanceEntryType.RESOURCE &&
    (!isAllowedRequestUrl(configuration, entry.name) ||
      !hasValidResourceEntryDuration(entry))
  )
}
