import { ConsoleApiName, display } from './display'
var onMonitorErrorCollected
var debugMode = false

export function startMonitorErrorCollection(newOnMonitorErrorCollected) {
  onMonitorErrorCollected = newOnMonitorErrorCollected
}

export function setDebugMode(newDebugMode) {
  debugMode = newDebugMode
}

export function resetMonitor() {
  onMonitorErrorCollected = undefined
  debugMode = false
}

export function monitor(fn) {
  return function () {
    return callMonitored(fn, this, arguments)
  }
}

export function callMonitored(fn, context, args) {
  try {
    return fn.apply(context, args)
  } catch (e) {
    monitorError(e)
  }
}
export function monitorError(e) {
  displayIfDebugEnabled(e)
  if (onMonitorErrorCollected) {
    try {
      onMonitorErrorCollected(e)
    } catch (e) {
      displayIfDebugEnabled(e)
    }
  }
}
export function displayIfDebugEnabled() {
  var args = [].slice.call(arguments)
  //   display.error.apply(null, ['[MONITOR]'].concat(args))
  if (debugMode) {
    display.error.apply(null, ['[MONITOR]'].concat(args))
  }
}
