import { addEventListener } from './addEventListener'
import {
  instrumentConstructor,
  instrumentMethod
} from '../helper/instrumentMethod'
import { Observable } from '../helper/observable'
import { computeBytesCount } from '../helper/byteUtils'
import { clocksNow } from '../helper/tools'

var webSocketObservable

export function initWebSocketObservable() {
  if (!webSocketObservable) {
    webSocketObservable = createWebSocketObservable()
  }
  return webSocketObservable
}

function createWebSocketObservable() {
  return new Observable(function (observable) {
    if (typeof window.WebSocket !== 'function') {
      return
    }

    var constructorInstrumentation = instrumentConstructor(
      window,
      'WebSocket',
      function (call) {
        var parameters = call.parameters
        var protocols = Array.isArray(parameters[1])
          ? parameters[1].slice()
          : parameters[1]
        var startClocks = clocksNow()

        call.onPostCall(function (instance) {
          observable.notify({
            state: 'connecting',
            instance: instance,
            url: instance.url,
            protocols: protocols,
            startClocks: startClocks
          })
          attachInstanceListeners(instance, observable)
        })
      }
    )

    var sendInstrumentation = instrumentMethod(
      window.WebSocket.prototype,
      'send',
      function (call) {
        var instance = call.target
        var size = computePayloadSize(call.parameters[0])
        var bufferedAmountPreSend = instance.bufferedAmount

        call.onPostCall(function () {
          observable.notify({
            state: 'message-out',
            instance: instance,
            size: size,
            bufferedAmountPreSend: bufferedAmountPreSend,
            at: clocksNow()
          })
        })
      }
    )

    return function () {
      constructorInstrumentation.stop()
      sendInstrumentation.stop()
    }
  })
}

function attachInstanceListeners(instance, observable) {
  var openListener = addEventListener(instance, 'open', function () {
    observable.notify({
      state: 'open',
      instance: instance,
      openClocks: clocksNow(),
      protocol: instance.protocol || ''
    })
    openListener.stop()
  })

  var messageListener = addEventListener(instance, 'message', function (event) {
    observable.notify({
      state: 'message-in',
      instance: instance,
      size: computePayloadSize(event.data),
      at: clocksNow()
    })
  })

  var closeListener = addEventListener(instance, 'close', function (event) {
    observable.notify({
      state: 'closed',
      instance: instance,
      code: event.code,
      reason: event.reason,
      wasClean: event.wasClean,
      at: clocksNow()
    })

    openListener.stop()
    messageListener.stop()
    closeListener.stop()
  })
}

export function computeWebSocketPayloadSize(data) {
  return computePayloadSize(data)
}

function computePayloadSize(data) {
  if (typeof data === 'string') {
    return computeBytesCount(data)
  }
  if (data instanceof ArrayBuffer || ArrayBuffer.isView(data)) {
    return data.byteLength
  }
  if (typeof Blob !== 'undefined' && data instanceof Blob) {
    return data.size
  }
  return 0
}

export function resetWebSocketObservable() {
  webSocketObservable = undefined
}
