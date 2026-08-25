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
  createContextManager,
  addEventListeners,
  canUseEventBridge
} from '@cloudcare/browser-core'

import { trackInitialViewMetrics } from './trackInitialViewTimings'
import { trackCommonViewMetrics } from './trackCommonViewMetrics'
import { trackViewEventCounts } from './trackViewEventCounts'
import { trackSoftNavigationMetrics } from './trackSoftNavigationMetrics'
import { getSelectorFromElement } from '../actions/getSelectorsFromElement'
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
  var eventBridgeAvailable = canUseEventBridge()
  var isWebViewActive =
    !eventBridgeAvailable ||
    (document.visibilityState !== 'hidden' && document.hasFocus())
  var activeViews = new Set()
  function startNewView(
    loadingType,
    startClocks,
    viewOptions,
    canMatchSoftNavigation,
    fallbackNavigationType
  ) {
    var newlyCreatedView = newView(
      lifeCycle,
      domMutationObservable,
      configuration,
      location,
      loadingType,
      startClocks,
      viewOptions,
      canMatchSoftNavigation,
      fallbackNavigationType
    )
    activeViews.add(newlyCreatedView)
    newlyCreatedView.stopObservable.subscribe(function () {
      activeViews.delete(newlyCreatedView)
      if (softNavigationView === newlyCreatedView) {
        softNavigationView = undefined
      }
    })
    if (!isWebViewActive) {
      newlyCreatedView.end({ sessionIsActive: false })
      newlyCreatedView.stop()
    }
    return newlyCreatedView
  }
  var currentView = startNewView(
    ViewLoadingType.INITIAL_LOAD,
    clocksOrigin(),
    initialViewOptions
  )
  var softNavigationView
  var softNavigationInteractionId
  var softNavigationMetricsTracking = trackSoftNavigationMetrics(
    function (entry) {
      if (entry.entryType === 'soft-navigation') {
        softNavigationView = findSoftNavigationView(activeViews, entry)
        softNavigationInteractionId = entry.interactionId
        if (softNavigationView) {
          softNavigationView.$rSetSoftNavigationMetrics(
            entry.navigationType,
            entry.duration,
            getSoftNavigationLcp(
              configuration,
              entry.getLargestInteractionContentfulPaint
                ? entry.getLargestInteractionContentfulPaint()
                : entry.largestInteractionContentfulPaint
            )
          )
        }
      } else if (
        softNavigationView &&
        softNavigationInteractionId === entry.interactionId
      ) {
        softNavigationView.$rSetSoftNavigationMetrics(
          undefined,
          undefined,
          getSoftNavigationLcp(configuration, entry)
        )
      }
    }
  )
  var stopWebViewLifecycleTracking = noop
  startViewLifeCycle()
  var pendingNavigation
  var locationChangeSubscription = renewViewOnLocationChange(
    locationChangeObservable
  )
  function startViewLifeCycle() {
    function renewCurrentView() {
      currentView = startNewView(ViewLoadingType.ROUTE_CHANGE, undefined, {
        name: currentView.name,
        service: currentView.service,
        version: currentView.version,
        context: currentView.contextManager.getContext()
      })
    }
    function endWebView() {
      currentView.end({ sessionIsActive: false })
      currentView.stop()
    }
    lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, renewCurrentView)

    lifeCycle.subscribe(LifeCycleEventType.SESSION_EXPIRED, function () {
      currentView.end({ sessionIsActive: false })
    })

    if (eventBridgeAvailable) {
      function updateWebViewLifecycle(event) {
        var nextIsActive =
          document.visibilityState !== 'hidden' && event.type !== 'blur'
        if (nextIsActive !== isWebViewActive) {
          isWebViewActive = nextIsActive
          isWebViewActive ? renewCurrentView() : endWebView()
        }
      }
      stopWebViewLifecycleTracking = addEventListeners(
        window,
        ['blur', 'focus', 'resume', 'visibilitychange'],
        updateWebViewLifecycle
      ).stop
    }
  }

  function renewViewOnLocationChange(locationChangeObservable) {
    return locationChangeObservable.subscribe(function (params) {
      var oldLocation = params.oldLocation
      var newLocation = params.newLocation
      if (areDifferentLocation(oldLocation, newLocation)) {
        if (!areViewsTrackedAutomatically) {
          pendingNavigation = [newLocation.href, params.navigationType]
          return
        }
        currentView.end()
        currentView = startNewView(
          ViewLoadingType.ROUTE_CHANGE,
          undefined,
          undefined,
          true,
          params.navigationType
        )
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
      var fallbackNavigationType
      if (
        pendingNavigation &&
        pendingNavigation[0] === location.href
      ) {
        fallbackNavigationType = pendingNavigation[1]
      }
      pendingNavigation = undefined
      currentView.end({ endClocks: startClocks })
      currentView = startNewView(
        ViewLoadingType.ROUTE_CHANGE,
        startClocks,
        options,
        true,
        fallbackNavigationType
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
      stopWebViewLifecycleTracking()
      softNavigationMetricsTracking()
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
  viewOptions,
  canMatchSoftNavigation,
  fallbackNavigationType
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
    version: version,
    url: viewOptions && viewOptions.url
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
  var navigationType = fallbackNavigationType
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
      navigationType: navigationType,
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
    },
    $rSetSoftNavigationMetrics: function (
      softNavigationType,
      firstContentfulPaint,
      largestContentfulPaint
    ) {
      navigationType = softNavigationType || navigationType
      if (typeof firstContentfulPaint === 'number') {
        initialViewMetrics.firstContentfulPaint = firstContentfulPaint
      }
      if (largestContentfulPaint) {
        initialViewMetrics.largestContentfulPaint = largestContentfulPaint
      }
      scheduleViewUpdate()
    }
  }
  result.$rLocation = location
  if (canMatchSoftNavigation) {
    result.$rSoftNavigationStart = startClocks.relative
  }
  return result
}

function findSoftNavigationView(activeViews, softNavigation) {
  // History tracking creates the View before Chrome emits its paint-backed
  // soft-navigation entry. Enrich that View instead of creating a duplicate.
  var matchingView
  var closestStart = Infinity
  activeViews.forEach(function (view) {
    var startDelay = view.$rSoftNavigationStart - softNavigation.startTime
    if (
      startDelay >= -1 &&
      startDelay < closestStart &&
      view.$rLocation.href === softNavigation.name
    ) {
      matchingView = view
      closestStart = startDelay
    }
  })
  return matchingView
}

function getSoftNavigationLcp(configuration, entry) {
  var candidate = entry && entry.largestContentfulPaint
  var renderTime = candidate && (candidate.renderTime || candidate.loadTime)
  if (renderTime) {
    return {
      value: Math.max(renderTime - entry.startTime, 0),
      targetSelector:
        candidate.element &&
        getSelectorFromElement(
          candidate.element,
          configuration.actionNameAttribute
        )
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
