import {
  getStatusGroup,
  UUID,
  extend,
  extend2Lev,
  relativeToClocks,
  urlParse,
  getQueryParamsFromUrl,
  replaceNumberCharByPath,
  RequestType,
  ResourceType,
  RumEventType,
  LifeCycleEventType,
  toServerDuration,
  createTaskQueue
} from '@cloudcare/browser-core'
import { matchRequestResourceEntry } from './matchRequestResourceEntry'
import {
  computePerformanceResourceDetails,
  computeResourceEntryDuration,
  computeResourceEntryType,
  computeResourceEntrySize,
  isResourceEntryRequestType,
  isResourceUrlLimit,
  isLongDataUrl,
  sanitizeDataUrl,
  computeResourceEntryDeliveryType,
  computeResourceEntryProtocol
} from './resourceUtils'
import { PageState } from '../../contexts/pageStateHistory'
import {
  createPerformanceObservable,
  RumPerformanceEntryType
} from '../../performanceObservable'
import { retrieveInitialDocumentResourceTiming } from './retrieveInitialDocumentResourceTiming'
export function startResourceCollection(
  lifeCycle,
  configuration,
  pageStateHistory,
  taskQueue,
  retrieveInitialDocumentResourceTimingImpl
) {
  if (taskQueue === undefined) {
    taskQueue = createTaskQueue()
  }
  if (typeof retrieveInitialDocumentResourceTimingImpl === 'undefined') {
    retrieveInitialDocumentResourceTimingImpl =
      retrieveInitialDocumentResourceTiming
  }
  lifeCycle.subscribe(LifeCycleEventType.REQUEST_COMPLETED, function (request) {
    handleResource(function () {
      return processRequest(request, pageStateHistory)
    })
  })
  var performanceResourceSubscription = createPerformanceObservable(
    configuration,
    {
      type: RumPerformanceEntryType.RESOURCE,
      buffered: true
    }
  ).subscribe(function (entries) {
    var loop = function (entry) {
      if (
        !isResourceEntryRequestType(entry) &&
        !isResourceUrlLimit(entry.name, configuration.resourceUrlLimit)
      ) {
        handleResource(function () {
          return processResourceEntry(entry, configuration)
        })
      }
    }
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
      var entry = entries_1[_i]
      loop(entry)
    }
  })

  retrieveInitialDocumentResourceTimingImpl(configuration, function (timing) {
    handleResource(function () {
      return processResourceEntry(timing, configuration)
    })
  })
  function handleResource(computeRawEvent) {
    taskQueue.push(function () {
      const rawEvent = computeRawEvent()
      if (rawEvent) {
        lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, rawEvent)
      }
    })
  }
  return {
    stop: function () {
      performanceResourceSubscription.unsubscribe()
    },
    addResource: (resource, savedCommonContext) => {
      handleResource(function () {
        return extend(
          { savedCommonContext: savedCommonContext },
          processCustomResource(resource)
        )
      })
    }
  }
}

function processRequest(request, pageStateHistory) {
  var matchingTiming = matchRequestResourceEntry(request)
  var startClocks = matchingTiming
    ? relativeToClocks(matchingTiming.startTime)
    : request.startClocks
  var tracingInfo = computeRequestTracingInfo(request)

  var type =
    request.type === RequestType.XHR ? ResourceType.XHR : ResourceType.FETCH
  var correspondingTimingOverrides = matchingTiming
    ? computeResourceEntryMetrics(matchingTiming)
    : undefined

  var duration = computeRequestDuration(
    pageStateHistory,
    startClocks,
    request.duration
  )

  var urlObj = urlParse(request.url).getParse()
  var resourceEvent = extend2Lev(
    {
      date: startClocks.timeStamp,
      resource: {
        id: UUID(),
        type: type,
        duration: duration,
        method: request.method,
        status: request.status,
        statusGroup: getStatusGroup(request.status),
        url: isLongDataUrl(request.url)
          ? sanitizeDataUrl(request.url)
          : request.url,
        urlHost: urlObj.Host,
        urlPath: urlObj.Path,
        urlPathGroup: replaceNumberCharByPath(urlObj.Path),
        urlQuery: getQueryParamsFromUrl(request.url),
        deliveryType:
          matchingTiming && computeResourceEntryDeliveryType(matchingTiming),
        protocol: matchingTiming && computeResourceEntryProtocol(matchingTiming)
      },
      type: RumEventType.RESOURCE
    },
    tracingInfo,
    correspondingTimingOverrides
  )
  return {
    startTime: startClocks.relative,
    rawRumEvent: resourceEvent,
    domainContext: {
      performanceEntry: matchingTiming,
      xhr: request.xhr,
      requestHeaderContexts: request.requestHeaderContexts,
      response: request.response,
      requestInput: request.input,
      requestInit: request.init,
      error: request.error,
      isAborted: request.isAborted,
      handlingStack: request.handlingStack
    }
  }
}

function processResourceEntry(entry, configuration) {
  var startClocks = relativeToClocks(entry.startTime)
  var tracingInfo = computeResourceEntryTracingInfo(entry)
  var type = computeResourceEntryType(entry)
  var entryMetrics = computeResourceEntryMetrics(entry)
  var urlObj = urlParse(entry.name).getParse()
  var resourceEvent = extend2Lev(
    {
      date: startClocks.timeStamp,
      resource: {
        id: UUID(),
        type: type,
        url: entry.name,
        urlHost: urlObj.Host,
        urlPath: urlObj.Path,
        urlPathGroup: replaceNumberCharByPath(urlObj.Path),
        urlQuery: getQueryParamsFromUrl(entry.name),
        method: 'GET',
        status: discardZeroStatus(entry.responseStatus),
        statusGroup: getStatusGroup(entry.responseStatus),
        deliveryType: computeResourceEntryDeliveryType(entry),
        protocol: computeResourceEntryProtocol(entry)
      },
      type: RumEventType.RESOURCE
    },
    tracingInfo,
    entryMetrics
  )
  return {
    startTime: startClocks.relative,
    rawRumEvent: resourceEvent,
    domainContext: {
      performanceEntry: entry
    }
  }
}
function processCustomResource(resource) {
  var resourceEvent = {
    date: resource.startClocks.timeStamp,
    resource: {
      id: UUID(),
      type: resource.type
    },
    type: RumEventType.RESOURCE
  }
  return {
    customerContext: resource.context,
    startTime: resource.startClocks.relative,
    rawRumEvent: resourceEvent,
    domainContext: {
      resource: resource
    }
  }
}
function computeResourceEntryMetrics(entry) {
  return {
    resource: extend2Lev(
      {},
      {
        duration: computeResourceEntryDuration(entry)
      },
      computeResourceEntrySize(entry),
      computePerformanceResourceDetails(entry)
    )
  }
}

function computeRequestTracingInfo(request) {
  var hasBeenTraced = request.traceSampled && request.traceId && request.spanId
  if (!hasBeenTraced) {
    return undefined
  }
  return {
    _gc: {
      spanId: request.spanId,
      traceId: request.traceId
    },
    resource: { id: UUID() }
  }
}

function computeRequestDuration(pageStateHistory, startClocks, duration) {
  return !pageStateHistory.wasInPageStateDuringPeriod(
    PageState.FROZEN,
    startClocks.relative,
    duration
  )
    ? toServerDuration(duration)
    : undefined
}
function computeResourceEntryTracingInfo(entry) {
  return entry.traceId ? { _gc: { traceId: entry.traceId } } : undefined
}
/**
 * The status is 0 for cross-origin resources without CORS headers, so the status is meaningless, and we shouldn't report it
 * https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/responseStatus#cross-origin_response_status_codes
 */
function discardZeroStatus(statusCode) {
  return statusCode === 0 ? undefined : statusCode
}
