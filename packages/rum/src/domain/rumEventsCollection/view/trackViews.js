import {
  shallowClone,
  elapsed,
  UUID,
  ONE_MINUTE,
  throttle,
  clocksNow,
  clocksOrigin,
  timeStampNow,
  looksLikeRelativeTime,
  ViewLoadingType,
  LifeCycleEventType,
  PageExitReason,
  isHashAnAnchor,
  getPathFromHash,
  noop,
  setInterval,
  Observable,
  clearInterval,
  setTimeout,
  isNullUndefinedDefaultValue,
  createContextManager
} from '@cloudcare/browser-core'

import { trackInitialViewMetrics } from './trackInitialViewTimings'
import { trackCommonViewMetrics } from './trackCommonViewMetrics'
import { trackViewEventCounts } from './trackViewEventCounts'
export var THROTTLE_VIEW_UPDATE_PERIOD = 3000
export var SESSION_KEEP_ALIVE_INTERVAL = 5 * ONE_MINUTE
export var KEEP_TRACKING_AFTER_VIEW_DELAY = 5 * ONE_MINUTE
export function trackViews(
  location,
  lifeCycle,
  domMutationObservable,
  configuration,
  locationChangeObservable,
  areViewsTrackedAutomatically,
  initialViewOptions
) {
  var activeViews = new Set()
  function startNewView(loadingType, startClocks, viewOptions) {
    var newlyCreatedView = newView(
      lifeCycle,
      domMutationObservable,
      configuration,
      location,
      loadingType,
      startClocks,
      viewOptions
    )
    activeViews.add(newlyCreatedView)
    newlyCreatedView.stopObservable.subscribe(function () {
      activeViews.delete(newlyCreatedView)
    })
    return newlyCreatedView
  }
  var currentView = startNewView(
    ViewLoadingType.INITIAL_LOAD,
    clocksOrigin(),
    initialViewOptions
  )
  startViewLifeCycle()
  var locationChangeSubscription
  if (areViewsTrackedAutomatically) {
    locationChangeSubscription = renewViewOnLocationChange(
      locationChangeObservable
    )
  }
  function startViewLifeCycle() {
    lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, function () {
      currentView = startNewView(ViewLoadingType.ROUTE_CHANGE, undefined, {
        name: currentView.name,
        service: currentView.service,
        version: currentView.version,
        context: currentView.contextManager.getContext()
      })
    })

    lifeCycle.subscribe(LifeCycleEventType.SESSION_EXPIRED, function () {
      currentView.end({ sessionIsActive: false })
    })
    // // End the current view on page unload
    // lifeCycle.subscribe(
    //   LifeCycleEventType.PAGE_EXITED,
    //   function (pageExitEvent) {
    //     if (pageExitEvent.reason === PageExitReason.UNLOADING) {
    //       currentView.end()
    //     }
    //   }
    // )
  }

  function renewViewOnLocationChange(locationChangeObservable) {
    return locationChangeObservable.subscribe(function (params) {
      var oldLocation = params.oldLocation
      var newLocation = params.newLocation
      if (areDifferentLocation(oldLocation, newLocation)) {
        currentView.end()
        currentView = startNewView(ViewLoadingType.ROUTE_CHANGE)
        return
      }
    })
  }

  return {
    addTiming: function (name, time) {
      if (typeof time === 'undefined') {
        time = timeStampNow()
      }
      currentView.addTiming(name, time)
    },
    startView: function (options, startClocks) {
      currentView.end({ endClocks: startClocks })
      currentView = startNewView(
        ViewLoadingType.ROUTE_CHANGE,
        startClocks,
        options
      )
    },
    setViewContext: (context) => {
      currentView.contextManager.setContext(context)
    },
    setViewContextProperty: (key, value) => {
      currentView.contextManager.setContextProperty(key, value)
    },
    setViewName: (name) => {
      currentView.setViewName(name)
    },
    getViewContext: () => currentView.contextManager.getContext(),
    stop: function () {
      if (locationChangeSubscription) {
        locationChangeSubscription.unsubscribe()
      }
      currentView.end()
      activeViews.forEach(function (view) {
        view.stop()
      })
    }
  }
}

function newView(
  lifeCycle,
  domMutationObservable,
  configuration,
  initialLocation,
  loadingType,
  startClocks,
  viewOptions
) {
  // Setup initial values
  if (startClocks === undefined) {
    startClocks = clocksNow()
  }
  var id = UUID()
  var stopObservable = new Observable()
  var customTimings = {}
  var documentVersion = 0
  var endClocks
  var location = shallowClone(initialLocation)
  const contextManager = createContextManager()
  var sessionIsActive = true
  var name
  var service
  var version
  var context
  if (viewOptions) {
    name = viewOptions.name
    service = viewOptions.service
    version = viewOptions.version
    context = viewOptions.context
  }
  if (context) {
    contextManager.setContext(context)
  }
  var viewCreatedEvent = {
    id: id,
    name: name,
    startClocks: startClocks,
    service: service,
    version: version
  }
  lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, viewCreatedEvent)
  lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, viewCreatedEvent)

  // Update the view every time the measures are changing
  var _scheduleViewUpdate = throttle(
    triggerViewUpdate,
    THROTTLE_VIEW_UPDATE_PERIOD,
    {
      leading: false
    }
  )
  var throttled = _scheduleViewUpdate.throttled
  var cancelScheduleViewUpdate = _scheduleViewUpdate.cancel

  var _trackCommonViewMetrics = trackCommonViewMetrics(
    lifeCycle,
    domMutationObservable,
    configuration,
    scheduleViewUpdate,
    loadingType,
    startClocks
  )
  var setLoadEvent = _trackCommonViewMetrics.setLoadEvent
  var stopCommonViewMetricsTracking = _trackCommonViewMetrics.stop
  var getCommonViewMetrics = _trackCommonViewMetrics.getCommonViewMetrics
  var stopINPTracking = _trackCommonViewMetrics.stopINPTracking
  var setViewEnd = _trackCommonViewMetrics.setViewEnd
  var _trackInitialViewTimings =
    loadingType === ViewLoadingType.INITIAL_LOAD
      ? trackInitialViewMetrics(
          configuration,
          startClocks,
          setLoadEvent,
          scheduleViewUpdate
        )
      : {
          stop: noop,
          initialViewMetrics: {}
        }
  var stopInitialViewMetricsTracking = _trackInitialViewTimings.stop
  var initialViewMetrics = _trackInitialViewTimings.initialViewMetrics
  var _trackViewEventCounts = trackViewEventCounts(
    lifeCycle,
    id,
    scheduleViewUpdate
  )
  var stopEventCountsTracking = _trackViewEventCounts.stop
  var eventCounts = _trackViewEventCounts.eventCounts

  // Session keep alive
  var keepAliveIntervalId = setInterval(
    triggerViewUpdate,
    SESSION_KEEP_ALIVE_INTERVAL
  )
  const pageMayExitSubscription = lifeCycle.subscribe(
    LifeCycleEventType.PAGE_EXITED,
    (pageMayExitEvent) => {
      if (pageMayExitEvent.reason === PageExitReason.UNLOADING) {
        triggerViewUpdate()
      }
    }
  )
  triggerViewUpdate()
  // View context update should always be throttled
  contextManager.changeObservable.subscribe(scheduleViewUpdate)

  function triggerBeforeViewUpdate() {
    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_UPDATED, {
      id,
      name,
      context: contextManager.getContext(),
      startClocks
    })
  }
  function scheduleViewUpdate() {
    triggerBeforeViewUpdate()
    throttled()
  }

  function triggerViewUpdate() {
    cancelScheduleViewUpdate()
    triggerBeforeViewUpdate()
    documentVersion += 1
    var currentEnd =
      endClocks === undefined ? timeStampNow() : endClocks.timeStamp
    lifeCycle.notify(LifeCycleEventType.VIEW_UPDATED, {
      customTimings: customTimings,
      documentVersion: documentVersion,
      id: id,
      name: name,
      service: service,
      version: version,
      context: contextManager.getContext(),
      loadingType: loadingType,
      location: location,
      startClocks: startClocks,
      commonViewMetrics: getCommonViewMetrics(),
      initialViewMetrics: initialViewMetrics,
      duration: elapsed(startClocks.timeStamp, currentEnd),
      isActive: endClocks === undefined,
      sessionIsActive: sessionIsActive,
      eventCounts: eventCounts
    })
  }
  var result = {
    name: name,
    service: service,
    version: version,
    contextManager: contextManager,
    stopObservable: stopObservable,
    end: function (options) {
      if (endClocks) {
        // view already ended
        return
      }
      endClocks = isNullUndefinedDefaultValue(
        options && options.endClocks,
        clocksNow()
      )
      sessionIsActive = isNullUndefinedDefaultValue(
        options && options.sessionIsActive,
        true
      )
      lifeCycle.notify(LifeCycleEventType.VIEW_ENDED, { endClocks: endClocks })
      lifeCycle.notify(LifeCycleEventType.AFTER_VIEW_ENDED, {
        endClocks: endClocks
      })
      clearInterval(keepAliveIntervalId)
      setViewEnd(endClocks.relative)
      stopCommonViewMetricsTracking()
      pageMayExitSubscription.unsubscribe()
      triggerViewUpdate()
      setTimeout(function () {
        result.stop()
      }, KEEP_TRACKING_AFTER_VIEW_DELAY)
    },
    stop: function () {
      stopInitialViewMetricsTracking()
      stopEventCountsTracking()
      stopINPTracking()
      stopObservable.notify()
    },
    addTiming: function (name, time) {
      if (endClocks) {
        return
      }
      var relativeTime = looksLikeRelativeTime(time)
        ? time
        : elapsed(startClocks.timeStamp, time)
      customTimings[sanitizeTiming(name)] = relativeTime
      scheduleViewUpdate()
    },
    setViewName(updatedName) {
      name = updatedName
      triggerViewUpdate()
    }
  }
  return result
}

/**
 * Timing name is used as facet path that must contain only letters, digits, or the characters - _ . @ $
 */
function sanitizeTiming(name) {
  var sanitized = name.replace(/[^a-zA-Z0-9-_.@$]/g, '_')
  if (sanitized !== name) {
    console.warn(
      'Invalid timing name: ' + name + ', sanitized to: ' + sanitized
    )
  }
  return sanitized
}

function areDifferentLocation(currentLocation, otherLocation) {
  return (
    currentLocation.pathname !== otherLocation.pathname ||
    (!isHashAnAnchor(otherLocation.hash) &&
      getPathFromHash(otherLocation.hash) !==
        getPathFromHash(currentLocation.hash))
  )
}
