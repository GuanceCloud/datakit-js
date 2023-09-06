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
  clearInterval,
  isNullUndefinedDefaultValue
} from '@cloudcare/browser-core'

import { trackInitialViewMetrics } from './trackInitialViewTimings'
import { trackCommonViewMetrics } from './trackCommonViewMetrics'
import { trackViewEventCounts } from './trackViewEventCounts'
export var THROTTLE_VIEW_UPDATE_PERIOD = 3000
export var SESSION_KEEP_ALIVE_INTERVAL = 5 * ONE_MINUTE

export function trackViews(
  location,
  lifeCycle,
  domMutationObservable,
  configuration,
  locationChangeObservable,
  areViewsTrackedAutomatically,
  initialViewOptions
) {
  function startNewView(loadingType, startClocks, viewOptions) {
    return newView(
      lifeCycle,
      domMutationObservable,
      configuration,
      location,
      loadingType,
      startClocks,
      viewOptions
    )
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
      startNewView(ViewLoadingType.ROUTE_CHANGE, undefined, {
        name: currentView.name,
        service: currentView.service,
        version: currentView.version
      })
    })

    lifeCycle.subscribe(LifeCycleEventType.SESSION_EXPIRED, function () {
      currentView.end({ sessionIsActive: false })
    })
    // End the current view on page unload
    lifeCycle.subscribe(
      LifeCycleEventType.PAGE_EXITED,
      function (pageExitEvent) {
        if (
          pageExitEvent.reason === PageExitReason.UNLOADING ||
          pageExitEvent.reason === PageExitReason.PAGEHIDE
        ) {
          currentView.end()
        }
      }
    )
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
    stop: function () {
      if (locationChangeSubscription) {
        locationChangeSubscription.unsubscribe()
      }
      currentView.end()
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
  if (typeof startClocks === 'undefined') {
    startClocks = clocksNow()
  }
  var id = UUID()
  var customTimings = {}
  var documentVersion = 0
  var endClocks
  var location = shallowClone(initialLocation)

  var sessionIsActive = true
  var name
  var service
  var version
  if (viewOptions) {
    name = viewOptions.name
    service = viewOptions.service
    version = viewOptions.version
  }

  lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, {
    id: id,
    name: name,
    startClocks: startClocks,
    service: service,
    version: version
  })

  // Update the view every time the measures are changing
  var _scheduleViewUpdate = throttle(
    triggerViewUpdate,
    THROTTLE_VIEW_UPDATE_PERIOD,
    {
      leading: false
    }
  )
  var scheduleViewUpdate = _scheduleViewUpdate.throttled
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

  var _trackInitialViewTimings =
    loadingType === ViewLoadingType.INITIAL_LOAD
      ? trackInitialViewMetrics(lifeCycle, setLoadEvent, scheduleViewUpdate)
      : {
          scheduleStop: noop,
          initialViewMetrics: {}
        }
  var scheduleStopInitialViewMetricsTracking =
    _trackInitialViewTimings.scheduleStop
  var initialViewMetrics = _trackInitialViewTimings.initialViewMetrics
  var _trackViewEventCounts = trackViewEventCounts(
    lifeCycle,
    id,
    scheduleViewUpdate
  )
  var scheduleStopEventCountsTracking = _trackViewEventCounts.scheduleStop
  var eventCounts = _trackViewEventCounts.eventCounts

  // Session keep alive
  var keepAliveIntervalId = setInterval(
    triggerViewUpdate,
    SESSION_KEEP_ALIVE_INTERVAL
  )
  // Initial view update
  triggerViewUpdate()

  function triggerViewUpdate() {
    cancelScheduleViewUpdate()

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

  return {
    name: name,
    service: service,
    version: version,
    scheduleUpdate: scheduleViewUpdate,
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
      clearInterval(keepAliveIntervalId)
      stopCommonViewMetricsTracking()
      scheduleStopInitialViewMetricsTracking()
      scheduleStopEventCountsTracking()
      triggerViewUpdate()
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
    }
  }
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
