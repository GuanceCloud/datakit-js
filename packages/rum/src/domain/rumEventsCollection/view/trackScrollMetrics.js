import {
  ONE_SECOND,
  elapsed,
  relativeNow,
  throttle,
  addEventListener,
  DOM_EVENT,
  getScrollY,
  monitor,
  Observable
} from '@cloudcare/browser-core'
import { getViewportDimension } from '../../initViewportObservable'

/** Arbitrary scroll throttle duration */
export var THROTTLE_SCROLL_DURATION = ONE_SECOND

export function trackScrollMetrics(
  configuration,
  viewStart,
  callback,
  scrollValues
) {
  if (scrollValues === undefined) {
    scrollValues = createScrollValuesObservable(configuration)
  }
  var maxScrollDepth = 0
  var maxScrollHeight = 0
  var maxScrollHeightTime = 0
  var subscription = scrollValues.subscribe(function (data) {
    var scrollDepth = data.scrollDepth
    var scrollTop = data.scrollTop
    var scrollHeight = data.scrollHeight
    var shouldUpdate = false

    if (scrollDepth > maxScrollDepth) {
      maxScrollDepth = scrollDepth
      shouldUpdate = true
    }

    if (scrollHeight > maxScrollHeight) {
      maxScrollHeight = scrollHeight
      var now = relativeNow()
      maxScrollHeightTime = elapsed(viewStart.relative, now)
      shouldUpdate = true
    }

    if (shouldUpdate) {
      callback({
        maxDepth: Math.min(maxScrollDepth, maxScrollHeight),
        maxDepthScrollTop: scrollTop,
        maxScrollHeight: maxScrollHeight,
        maxScrollHeightTime: maxScrollHeightTime
      })
    }
  })

  return {
    stop: function () {
      return subscription.unsubscribe()
    }
  }
}

export function computeScrollValues() {
  var scrollTop = getScrollY()

  var viewport = getViewportDimension()
  var height = viewport.height
  var scrollHeight = Math.round(
    (document.scrollingElement || document.documentElement).scrollHeight
  )
  var scrollDepth = Math.round(height + scrollTop)

  return {
    scrollHeight: scrollHeight,
    scrollDepth: scrollDepth,
    scrollTop: scrollTop
  }
}
export function createScrollValuesObservable(configuration, throttleDuration) {
  if (throttleDuration === undefined) {
    throttleDuration = THROTTLE_SCROLL_DURATION
  }
  return new Observable(function (observable) {
    function notify() {
      observable.notify(computeScrollValues())
    }

    if (window.ResizeObserver) {
      var throttledNotify = throttle(notify, throttleDuration, {
        leading: false,
        trailing: true
      })

      var observerTarget = document.scrollingElement || document.documentElement
      var resizeObserver = new ResizeObserver(
        monitor(throttledNotify.throttled)
      )
      if (observerTarget) {
        resizeObserver.observe(observerTarget)
      }
      var eventListener = addEventListener(
        window,
        DOM_EVENT.SCROLL,
        throttledNotify.throttled,
        {
          passive: true
        }
      )

      return function () {
        throttledNotify.cancel()
        resizeObserver.unobserve(observerTarget)
        eventListener.stop()
      }
    }
  })
}
