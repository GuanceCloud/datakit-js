import {
  Observable,
  each,
  timeStampNow,
  LifeCycleEventType,
  some,
  matchList,
  instrumentMethod,
  setTimeout,
  clearTimeout
} from '@cloudcare/browser-core'
import {
  createPerformanceObservable,
  RumPerformanceEntryType
} from '../domain/performanceObservable'
// Delay to wait for a page activity to validate the tracking process
export var PAGE_ACTIVITY_VALIDATION_DELAY = 100
// Delay to wait after a page activity to end the tracking process
export var PAGE_ACTIVITY_END_DELAY = 100

/**
 * Wait for the page activity end
 *
 * Detection lifecycle:
 * ```
 *                        Wait page activity end
 *              .-------------------'--------------------.
 *              v                                        v
 *     [Wait for a page activity ]          [Wait for a maximum duration]
 *     [timeout: VALIDATION_DELAY]          [  timeout: maxDuration     ]
 *          /                  \                           |
 *         v                    v                          |
 *  [No page activity]   [Page activity]                   |
 *         |                   |,----------------------.   |
 *         v                   v                       |   |
 *     (Discard)     [Wait for a page activity]        |   |
 *                   [   timeout: END_DELAY   ]        |   |
 *                       /                \            |   |
 *                      v                  v           |   |
 *             [No page activity]    [Page activity]   |   |
 *                      |                 |            |   |
 *                      |                 '------------'   |
 *                      '-----------. ,--------------------'
 *                                   v
 *                                 (End)
 * ```
 *
 * Note: by assuming that maxDuration is greater than VALIDATION_DELAY, we are sure that if the
 * process is still alive after maxDuration, it has been validated.
 */
export function waitPageActivityEnd(
  lifeCycle,
  domMutationObservable,
  configuration,
  pageActivityEndCallback,
  maxDuration
) {
  var pageActivityObservable = createPageActivityObservable(
    lifeCycle,
    domMutationObservable,
    configuration
  )
  return doWaitPageActivityEnd(
    pageActivityObservable,
    pageActivityEndCallback,
    maxDuration
  )
}

export function doWaitPageActivityEnd(
  pageActivityObservable,
  pageActivityEndCallback,
  maxDuration
) {
  var pageActivityEndTimeoutId
  var hasCompleted = false
  var validationTimeoutId = setTimeout(function () {
    complete({ hadActivity: false })
  }, PAGE_ACTIVITY_VALIDATION_DELAY)

  var maxDurationTimeoutId =
    maxDuration !== undefined
      ? setTimeout(function () {
          return complete({ hadActivity: true, end: timeStampNow() })
        }, maxDuration)
      : undefined

  var pageActivitySubscription = pageActivityObservable.subscribe(function (
    data
  ) {
    var isBusy = data.isBusy
    clearTimeout(validationTimeoutId)
    clearTimeout(pageActivityEndTimeoutId)
    var lastChangeTime = timeStampNow()
    if (!isBusy) {
      pageActivityEndTimeoutId = setTimeout(function () {
        complete({ hadActivity: true, end: lastChangeTime })
      }, PAGE_ACTIVITY_END_DELAY)
    }
  })
  var stop = function () {
    hasCompleted = true
    clearTimeout(validationTimeoutId)
    clearTimeout(pageActivityEndTimeoutId)
    clearTimeout(maxDurationTimeoutId)
    pageActivitySubscription.unsubscribe()
  }
  function complete(event) {
    if (hasCompleted) {
      return
    }
    stop && stop()
    pageActivityEndCallback(event)
  }
  return { stop: stop }
}

export function createPageActivityObservable(
  lifeCycle,
  domMutationObservable,
  configuration
) {
  return new Observable(function (observable) {
    var subscriptions = []
    var firstRequestIndex
    var pendingRequestsCount = 0

    subscriptions.push(
      domMutationObservable.subscribe(() => {
        notifyPageActivity()
      }),
      createPerformanceObservable(configuration, {
        type: RumPerformanceEntryType.RESOURCE
      }).subscribe(function (entries) {
        if (
          some(entries, function (entry) {
            return !isExcludedUrl(configuration, entry.name)
          })
        ) {
          notifyPageActivity()
        }
      }),
      lifeCycle.subscribe(
        LifeCycleEventType.REQUEST_STARTED,
        function (startEvent) {
          if (isExcludedUrl(configuration, startEvent.url)) {
            return
          }

          if (firstRequestIndex === undefined) {
            firstRequestIndex = startEvent.requestIndex
          }
          pendingRequestsCount += 1
          notifyPageActivity()
        }
      ),
      lifeCycle.subscribe(
        LifeCycleEventType.REQUEST_COMPLETED,
        function (request) {
          if (
            isExcludedUrl(configuration, request.url) ||
            firstRequestIndex === undefined ||
            // If the request started before the tracking start, ignore it
            request.requestIndex < firstRequestIndex
          ) {
            return
          }

          pendingRequestsCount -= 1
          notifyPageActivity()
        }
      )
    )

    var _trackWindowOpen = trackWindowOpen(notifyPageActivity)
    var stopTrackingWindowOpen = _trackWindowOpen.stop
    return function () {
      stopTrackingWindowOpen()
      each(subscriptions, function (s) {
        s.unsubscribe()
      })
    }

    function notifyPageActivity() {
      observable.notify({ isBusy: pendingRequestsCount > 0 })
    }
  })
}

function isExcludedUrl(configuration, requestUrl) {
  return matchList(configuration.excludedActivityUrls, requestUrl)
}

function trackWindowOpen(callback) {
  return instrumentMethod(window, 'open', callback)
}
