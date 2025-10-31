import {
  RequestType,
  initFetchObservable,
  initXhrObservable,
  LifeCycleEventType,
  tryToClone,
  readBytesFromStream,
  elapsed,
  timeStampNow
} from '@cloudcare/browser-core'
import { isAllowedRequestUrl } from './rumEventsCollection/resource/resourceUtils'
import { startTracer } from './tracing/tracer'

var nextRequestIndex = 1

export function startRequestCollection(
  lifeCycle,
  configuration,
  sessionManager
) {
  var tracer = startTracer(configuration, sessionManager)
  trackXhr(lifeCycle, configuration, tracer)
  trackFetch(lifeCycle, configuration, tracer)
}

export function trackXhr(lifeCycle, configuration, tracer) {
  var subscription = initXhrObservable().subscribe(function (rawContext) {
    var context = rawContext
    if (!isAllowedRequestUrl(configuration, context.url)) {
      return
    }

    switch (context.state) {
      case 'start':
        tracer.traceXhr(context, context.xhr)
        context.requestIndex = getNextRequestIndex()

        lifeCycle.notify(LifeCycleEventType.REQUEST_STARTED, {
          requestIndex: context.requestIndex,
          url: context.url
        })
        break
      case 'complete':
        tracer.clearTracingIfNeeded(context)
        lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
          duration: context.duration,
          method: context.method,
          requestIndex: context.requestIndex,
          spanId: context.spanId,
          startClocks: context.startClocks,
          status: context.status,
          traceId: context.traceId,
          traceSampled: context.traceSampled,
          type: RequestType.XHR,
          url: context.url,
          xhr: context.xhr,
          isAborted: context.isAborted,
          requestHeaderContexts: context.requestHeaderContexts,
          handlingStack: context.handlingStack
        })
        break
    }
  })

  return {
    stop: function () {
      return subscription.unsubscribe()
    }
  }
}

export function trackFetch(lifeCycle, configuration, tracer) {
  var subscription = initFetchObservable().subscribe(function (rawContext) {
    var context = rawContext
    if (!isAllowedRequestUrl(configuration, context.url)) {
      return
    }

    switch (context.state) {
      case 'start':
        tracer.traceFetch(context)
        context.requestIndex = getNextRequestIndex()

        lifeCycle.notify(LifeCycleEventType.REQUEST_STARTED, {
          requestIndex: context.requestIndex,
          url: context.url
        })
        break
      case 'resolve':
        waitForResponseToComplete(context, function (duration) {
          tracer.clearTracingIfNeeded(context)
          lifeCycle.notify(LifeCycleEventType.REQUEST_COMPLETED, {
            duration: duration,
            method: context.method,
            requestIndex: context.requestIndex,
            responseType: context.responseType,
            spanId: context.spanId,
            startClocks: context.startClocks,
            status: context.status,
            traceId: context.traceId,
            traceSampled: context.traceSampled,
            requestHeaderContexts: context.init?.headers,
            type: RequestType.FETCH,
            url: context.url,
            response: context.response,
            init: context.init,
            input: context.input,
            isAborted: context.isAborted,
            handlingStack: context.handlingStack
          })
        })
        break
    }
  })
  return {
    stop: function () {
      return subscription.unsubscribe()
    }
  }
}

function getNextRequestIndex() {
  var result = nextRequestIndex
  nextRequestIndex += 1
  return result
}

function waitForResponseToComplete(context, callback) {
  var clonedResponse = context.response && tryToClone(context.response)
  if (!clonedResponse || !clonedResponse.body) {
    // do not try to wait for the response if the clone failed, fetch error or null body
    callback(elapsed(context.startClocks.timeStamp, timeStampNow()))
  } else {
    readBytesFromStream(
      clonedResponse.body,
      function () {
        callback(elapsed(context.startClocks.timeStamp, timeStampNow()))
      },
      {
        bytesLimit: Number.POSITIVE_INFINITY,
        collectStreamBody: false
      }
    )
  }
}
