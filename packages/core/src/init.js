import { each, assign } from './helper/tools'
import { setDebugMode } from './helper/monitor'
import { catchUserErrors } from './helper/catchUserErrors'

export function makePublicApi(stub) {
  var publicApi = assign(
    {
      onReady: function (callback) {
        callback()
      }
    },
    stub
  )

  // Add an "hidden" property to set debug mode. We define it that way to hide it
  // as much as possible but of course it's not a real protection.
  Object.defineProperty(publicApi, '_setDebug', {
    get: function () {
      return setDebugMode
    },
    enumerable: false
  })

  return publicApi
}
export function defineGlobal(global, name, api) {
  var existingGlobalVariable = global[name]
  global[name] = api
  if (existingGlobalVariable && existingGlobalVariable.q) {
    each(existingGlobalVariable.q, function (fn) {
      catchUserErrors(fn, 'onReady callback threw an error:')()
    })
  }
}

export function getGlobalObject() {
  if (typeof globalThis === 'object') {
    return globalThis
  }
  Object.defineProperty(Object.prototype, '_gc_temp_', {
    get: function () {
      return this
    },
    configurable: true
  })
  // @ts-ignore
  var globalObject = _gc_temp_
  // @ts-ignore
  delete Object.prototype._gc_temp_
  if (typeof globalObject !== 'object') {
    // on safari _gc_temp_ is available on window but not globally
    // fallback on other browser globals check
    if (typeof self === 'object') {
      globalObject = self
    } else if (typeof window === 'object') {
      globalObject = window
    } else {
      globalObject = {}
    }
  }
  return globalObject
}
