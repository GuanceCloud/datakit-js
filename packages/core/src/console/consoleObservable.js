import { computeStackTrace } from '../tracekit'
import {
  createHandlingStack,
  formatErrorMessage,
  toStackTraceString,
  flattenErrorCauses
} from '../helper/errorTools'
import { mergeObservables, Observable } from '../helper/observable'
import { find, map, clocksNow } from '../helper/tools'
import { jsonStringify } from '../helper/serialisation/jsonStringify'
import { ConsoleApiName } from '../helper/display'
import { callMonitored } from '../helper/monitor'
import { ErrorHandling } from '../helper/enums'
import { ErrorSource } from '../helper/errorTools'
var consoleObservablesByApi = {}

export function initConsoleObservable(apis) {
  var consoleObservables = map(apis, function (api) {
    if (!consoleObservablesByApi[api]) {
      consoleObservablesByApi[api] = createConsoleObservable(api)
    }
    return consoleObservablesByApi[api]
  })

  return mergeObservables.apply(this, consoleObservables)
}
export function resetConsoleObservable() {
  consoleObservablesByApi = {}
}
/* eslint-disable no-console */
function createConsoleObservable(api) {
  return new Observable(function (observable) {
    var originalConsoleApi = console[api]
    console[api] = function () {
      var params = [].slice.call(arguments)
      originalConsoleApi.apply(console, arguments)
      var handlingStack = createHandlingStack()
      callMonitored(function () {
        observable.notify(buildConsoleLog(params, api, handlingStack))
      })
    }
    return function () {
      console[api] = originalConsoleApi
    }
  })
}

function buildConsoleLog(params, api, handlingStack) {
  var message = map(params, function (param) {
    return formatConsoleParameters(param)
  }).join(' ')
  var error
  if (api === ConsoleApiName.error) {
    var firstErrorParam = find(params, function (param) {
      return param instanceof Error
    })
    error = {
      stack: firstErrorParam
        ? toStackTraceString(computeStackTrace(firstErrorParam))
        : undefined,
      causes: firstErrorParam
        ? flattenErrorCauses(firstErrorParam, 'console')
        : undefined,
      startClocks: clocksNow(),
      message: message,
      source: ErrorSource.CONSOLE,
      handling: ErrorHandling.HANDLED,
      handlingStack: handlingStack
    }
  }

  return {
    api: api,
    message: message,
    error: error,
    handlingStack: handlingStack
  }
}

function formatConsoleParameters(param) {
  if (typeof param === 'string') {
    return param
  }
  if (param instanceof Error) {
    return formatErrorMessage(computeStackTrace(param))
  }
  return jsonStringify(param, undefined, 2)
}
