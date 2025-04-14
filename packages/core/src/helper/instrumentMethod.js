import { noop, arrayFrom, startsWith } from './tools'
import { setTimeout } from './timer'
import { callMonitored } from './monitor'
import { createHandlingStack } from './errorTools'
export function instrumentMethod(targetPrototype, method, onPreCall, opts) {
  var computeHandlingStack = opts && opts.computeHandlingStack
  var original = targetPrototype[method]

  if (typeof original !== 'function') {
    if (startsWith(method, 'on')) {
      original = noop
    } else {
      return { stop: noop }
    }
  }

  var stopped = false

  var instrumentation = function () {
    if (stopped) {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-return, @typescript-eslint/no-unsafe-call
      return original.apply(this, arguments)
    }

    var parameters = arrayFrom(arguments)

    var postCallCallback

    callMonitored(onPreCall, null, [
      {
        target: this,
        parameters: parameters,
        onPostCall: function (callback) {
          postCallCallback = callback
        },
        handlingStack: computeHandlingStack ? createHandlingStack() : undefined
      }
    ])

    var result = original.apply(this, parameters)

    if (postCallCallback) {
      callMonitored(postCallCallback, null, [result])
    }

    // eslint-disable-next-line @typescript-eslint/no-unsafe-return
    return result
  }

  targetPrototype[method] = instrumentation

  return {
    stop: function () {
      stopped = true
      // If the instrumentation has been removed by a third party, keep the last one
      if (targetPrototype[method] === instrumentation) {
        targetPrototype[method] = original
      }
    }
  }
}

export function instrumentSetter(targetPrototype, property, after) {
  var originalDescriptor = Object.getOwnPropertyDescriptor(
    targetPrototype,
    property
  )
  if (
    !originalDescriptor ||
    !originalDescriptor.set ||
    !originalDescriptor.configurable
  ) {
    return { stop: noop }
  }

  var stoppedInstrumentation = noop
  var instrumentation = function (target, value) {
    // put hooked setter into event loop to avoid of set latency
    setTimeout(function () {
      if (instrumentation !== stoppedInstrumentation) {
        after(target, value)
      }
    }, 0)
  }

  var instrumentationWrapper = function (value) {
    originalDescriptor.set.call(this, value)
    instrumentation(this, value)
  }

  Object.defineProperty(targetPrototype, property, {
    set: instrumentationWrapper
  })

  return {
    stop: function () {
      if (
        Object.getOwnPropertyDescriptor(targetPrototype, property) &&
        Object.getOwnPropertyDescriptor(targetPrototype, property).set ===
          instrumentationWrapper
      ) {
        Object.defineProperty(targetPrototype, property, originalDescriptor)
      }
      instrumentation = stoppedInstrumentation
    }
  }
}
