import { each } from '../helper/tools'
import { getZoneJsOriginalValue } from '../helper/getZoneJsOriginalValue'
import { monitor } from '../helper/monitor'
export function addEventListener(eventTarget, event, listener, options) {
  return addEventListeners(eventTarget, [event], listener, options)
}

/**
 * Add event listeners to an event emitter object (Window, Element, mock object...).  This provides
 * a few conveniences compared to using `element.addEventListener` directly:
 *
 * * supports IE11 by:
 *   * using an option object only if needed
 *   * emulating the `once` option
 *
 * * wraps the listener with a `monitor` function
 *
 * * returns a `stop` function to remove the listener
 *
 * * with `once: true`, the listener will be called at most once, even if different events are
 *   listened
 */

export function addEventListeners(eventTarget, eventNames, listener, options) {
  var wrappedListener = monitor(
    options && options.once
      ? function (event) {
          stop()
          listener(event)
        }
      : listener
  )
  options =
    options && options.passive
      ? { capture: options.capture, passive: options.passive }
      : options && options.capture
  // Use the window.EventTarget.prototype when possible to avoid wrong overrides (e.g: https://github.com/salesforce/lwc/issues/1824)
  //   const istarget = Object.prototype.toString.call(window)
  //   const listenerTarget =
  //     window.EventTarget && eventTarget instanceof EventTarget
  //       ? window.EventTarget.prototype
  //       : eventTarget
  //   var add = getZoneJsOriginalValue(listenerTarget, 'addEventListener')

  //   eventNames.forEach((eventName) => {
  //     add.call(eventTarget, eventName, wrappedListener, options)
  //   })
  each(eventNames, function (eventName) {
    withOriginalOrZoneJsPatchedMethod(
      eventTarget,
      'addEventListener',
      (method) => method.call(eventTarget, eventName, wrappedListener, options)
    )
    // add.call(eventTarget, eventName, wrappedListener, options)
  })
  var stop = function () {
    // var remove = getZoneJsOriginalValue(listenerTarget, 'removeEventListener')
    each(eventNames, function (eventName) {
      withOriginalOrZoneJsPatchedMethod(
        eventTarget,
        'removeEventListener',
        (method) =>
          method.call(eventTarget, eventName, wrappedListener, options)
      )
      //   remove.call(eventTarget, eventName, wrappedListener, options)
    })
  }
  return {
    stop: stop
  }
}
function isIllegalInvocationError(error, methodName) {
  if (!(error instanceof Error)) {
    return false
  }

  return (
    error.message.includes('Illegal invocation') || // chrome
    error.message.includes(
      `'${methodName}' called on an object that does not implement interface EventTarget.`
    ) || // firefox
    error.message.includes(
      `Can only call EventTarget.${methodName} on instances of EventTarget`
    ) // safari
  )
}

function withOriginalOrZoneJsPatchedMethod(eventTarget, methodName, cb) {
  // Use the window.EventTarget.prototype when possible to avoid wrong overrides (e.g: https://github.com/salesforce/lwc/issues/1824)
  const listenerTarget =
    window.EventTarget && eventTarget instanceof EventTarget
      ? window.EventTarget.prototype
      : eventTarget

  const originalMethod = getZoneJsOriginalValue(listenerTarget, methodName)

  try {
    // In some cases this call fails with an Illegal invocation error, we then catch the error and use the zone.js
    // patched method
    cb(originalMethod)
  } catch (error) {
    if (isIllegalInvocationError(error, methodName)) {
      return cb(eventTarget[methodName])
    }

    throw error
  }
}
