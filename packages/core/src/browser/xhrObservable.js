import { instrumentMethod } from '../helper/instrumentMethod'
import { Observable } from '../helper/observable'
import { normalizeUrl } from '../helper/urlPolyfill'
import { shallowClone, elapsed, clocksNow, timeStampNow } from '../helper/tools'
import { addEventListener } from '../browser/addEventListener'
var xhrObservable
var xhrContexts = new WeakMap()
export function initXhrObservable() {
  if (!xhrObservable) {
    xhrObservable = createXhrObservable()
  }
  return xhrObservable
}

function createXhrObservable() {
  return new Observable(function (observable) {
    var openInstrumentMethod = instrumentMethod(
      XMLHttpRequest.prototype,
      'open',
      openXhr
    )

    var sendInstrumentMethod = instrumentMethod(
      XMLHttpRequest.prototype,
      'send',
      function (call) {
        sendXhr(call, observable)
      },
      { computeHandlingStack: true }
    )
    var setRequestHeaderInstrumentMethod = instrumentMethod(
      XMLHttpRequest.prototype,
      'setRequestHeader',
      setRequestHeaderXhr
    )
    var abortInstrumentMethod = instrumentMethod(
      XMLHttpRequest.prototype,
      'abort',
      abortXhr
    )

    return function () {
      openInstrumentMethod.stop()
      sendInstrumentMethod.stop()
      abortInstrumentMethod.stop()
      setRequestHeaderInstrumentMethod.stop()
    }
  })
}

function openXhr(params) {
  var xhr = params.target
  var method = params.parameters[0]
  var url = params.parameters[1]
  xhrContexts.set(xhr, {
    state: 'open',
    method: String(method).toUpperCase(),
    url: normalizeUrl(String(url))
  })
}
function setRequestHeaderXhr(params) {
  var xhr = params.target
  var headerKey = params.parameters[0]
  var headerValue = params.parameters[1]
  var context = xhrContexts.get(xhr)
  if (context && headerKey) {
    var requestHeaderContexts = context.requestHeaderContexts || {}
    requestHeaderContexts[headerKey] = headerValue
    context.requestHeaderContexts = requestHeaderContexts
  }
}
function sendXhr(params, observable) {
  var xhr = params.target
  var handlingStack = params.handlingStack
  var context = xhrContexts.get(xhr)
  if (!context) {
    return
  }
  var startContext = context
  startContext.state = 'start'
  startContext.startClocks = clocksNow()
  startContext.isAborted = false
  startContext.xhr = xhr
  startContext.handlingStack = handlingStack
  var hasBeenReported = false
  var stopInstrumentingOnReadyStateChange = instrumentMethod(
    xhr,
    'onreadystatechange',
    function () {
      if (xhr.readyState === XMLHttpRequest.DONE) {
        // Try to report the XHR as soon as possible, because the XHR may be mutated by the
        // application during a future event. For example, Angular is calling .abort() on
        // completed requests during a onreadystatechange event, so the status becomes '0'
        // before the request is collected.
        onEnd()
      }
    }
  ).stop

  var onEnd = function () {
    unsubscribeLoadEndListener()
    stopInstrumentingOnReadyStateChange()
    if (hasBeenReported) {
      return
    }
    hasBeenReported = true
    var completeContext = context
    completeContext.state = 'complete'
    completeContext.duration = elapsed(
      startContext.startClocks.timeStamp,
      timeStampNow()
    )
    completeContext.status = xhr.status
    observable.notify(shallowClone(completeContext))
  }
  var unsubscribeLoadEndListener = addEventListener(xhr, 'loadend', onEnd).stop
  observable.notify(startContext)
}

function abortXhr(params) {
  var xhr = params.target
  var context = xhrContexts.get(xhr)
  if (context) {
    context.isAborted = true
  }
}
