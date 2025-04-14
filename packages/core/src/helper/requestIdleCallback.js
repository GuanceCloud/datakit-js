import { setTimeout, clearTimeout } from './timer'
import { monitor } from './monitor'
import { dateNow } from './tools'

/**
 * 'requestIdleCallback' with a shim.
 */
export function requestIdleCallback(callback, opts) {
  // Note: check both 'requestIdleCallback' and 'cancelIdleCallback' existence because some polyfills only implement 'requestIdleCallback'.
  if (window.requestIdleCallback && window.cancelIdleCallback) {
    const id = window.requestIdleCallback(monitor(callback), opts)
    return function () {
      return window.cancelIdleCallback(id)
    }
  }
  return requestIdleCallbackShim(callback)
}

export const MAX_TASK_TIME = 50

/*
 * Shim from https://developer.chrome.com/blog/using-requestidlecallback#checking_for_requestidlecallback
 * Note: there is no simple way to support the "timeout" option, so we ignore it.
 */
export function requestIdleCallbackShim(callback) {
  const start = dateNow()
  const timeoutId = setTimeout(function () {
    callback({
      didTimeout: false,
      timeRemaining: function () {
        return Math.max(0, MAX_TASK_TIME - (dateNow() - start))
      }
    })
  }, 0)
  return function () {
    return clearTimeout(timeoutId)
  }
}
