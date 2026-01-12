import { computeStackTrace } from '../tracekit'
import {
  createHandlingStack,
  formatErrorMessage,
  computeRawError,
  isError
} from '../helper/errorTools'
import { mergeObservables, Observable } from '../helper/observable'
import { find, map, clocksNow } from '../helper/tools'
import { jsonStringify } from '../helper/serialisation/jsonStringify'
import { ConsoleApiName } from '../helper/display'
import { callMonitored } from '../helper/monitor'
import { ErrorHandling, NonErrorPrefix } from '../helper/enums'
import { ErrorSource } from '../helper/errorTools'
import { sanitize } from '../helper/sanitize'
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
  if (api === ConsoleApiName.error) {
    var firstErrorParam = find(params, isError)
    const rawError = computeRawError({
      originalError: firstErrorParam,
      startClocks: clocksNow(),
      message: message,
      source: ErrorSource.CONSOLE,
      handling: ErrorHandling.HANDLED,
      handlingStack: handlingStack,
      nonErrorPrefix: NonErrorPrefix.PROVIDED,
      useFallbackStack: false
    })
    rawError.message = message
    return {
      api: api,
      message: message,
      error: rawError,
      handlingStack: handlingStack
    }
  }

  return {
    api: api,
    message: message,
    error: undefined,
    handlingStack: handlingStack
  }
}

function formatConsoleParameters(param) {
  if (typeof param === 'string') {
    return sanitize(param)
  }
  if (isError(param)) {
    return formatErrorMessage(computeStackTrace(param))
  }
  return jsonStringify(sanitize(param), undefined, 2)
}
