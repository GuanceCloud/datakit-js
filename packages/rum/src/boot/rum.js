import {
  startRumSessionManager,
  startRumSessionManagerStub
} from '../domain/rumSessionManager'
import { startCacheUsrCache } from '../domain/usr'
import {
  LifeCycle,
  LifeCycleEventType,
  createPageExitObservable,
  canUseEventBridge,
  startTelemetry,
  TelemetryService,
  drainPreStartTelemetry
} from '@cloudcare/browser-core'
import { createDOMMutationObservable } from '../domain/domMutationObservable.js'
import { createLocationChangeObservable } from '../domain/locationChangeObservable'
import { startLongTaskCollection } from '../domain/rumEventsCollection/longTask/longTaskCollection'
import { startLongAnimationFrameCollection } from '../domain/rumEventsCollection/longTask/longAnimationFrameCollection'
import { RumPerformanceEntryType } from '../domain/performanceObservable'
import { startActionCollection } from '../domain/rumEventsCollection/actions/actionCollection'
import { startRumBatch } from '../transport/startRumBatch'
import { startRumEventBridge } from '../transport/startRumEventBridge'
import { startRumAssembly } from '../domain/assembly'
import { startDisplayContext } from '../domain/contexts/displayContext.js'
import { startInternalContext } from '../domain/contexts/internalContext'
import { startUrlContexts } from '../domain/contexts/urlContexts'
import { startViewContexts } from '../domain/contexts/viewContexts'
import { startPageStateHistory } from '../domain/contexts/pageStateHistory'
import { startErrorCollection } from '../domain/rumEventsCollection/error/errorCollection'
import { startViewCollection } from '../domain/rumEventsCollection/view/viewCollection'
import { startRequestCollection } from '../domain/requestCollection'
import { startResourceCollection } from '../domain/rumEventsCollection/resource/resourceCollection'

export function startRum(
  configuration,
  recorderApi,
  customerDataTrackerManager,
  getCommonContext,
  initialViewOptions,
  createEncoder
) {
  var cleanupTasks = []
  var lifeCycle = new LifeCycle()
  var telemetry = startRumTelemetry(configuration)

  var reportError = function (error) {
    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, { error: error })
  }
  var pageExitObservable = createPageExitObservable()
  var pageExitSubscription = pageExitObservable.subscribe(function (event) {
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, event)
  })
  cleanupTasks.push(function () {
    pageExitSubscription.unsubscribe()
  })
  var session = !canUseEventBridge()
    ? startRumSessionManager(configuration, lifeCycle)
    : startRumSessionManagerStub()
  if (!canUseEventBridge()) {
    var batch = startRumBatch(
      configuration,
      lifeCycle,
      telemetry.observable,
      reportError,
      pageExitObservable,
      session.expireObservable,
      createEncoder
    )
    cleanupTasks.push(function () {
      batch.stop()
    })
  } else {
    startRumEventBridge(lifeCycle)
  }

  var userSession = startCacheUsrCache(configuration)
  var domMutationObservable = createDOMMutationObservable()
  var locationChangeObservable = createLocationChangeObservable(location)
  var pageStateHistory = startPageStateHistory()
  var _startRumEventCollection = startRumEventCollection(
    lifeCycle,
    configuration,
    location,
    session,
    userSession,
    pageStateHistory,
    locationChangeObservable,
    domMutationObservable,
    getCommonContext,
    reportError
  )
  var viewContexts = _startRumEventCollection.viewContexts
  var urlContexts = _startRumEventCollection.urlContexts
  var actionContexts = _startRumEventCollection.actionContexts
  var stopRumEventCollection = _startRumEventCollection.stop
  var addAction = _startRumEventCollection.addAction
  cleanupTasks.push(stopRumEventCollection)
  drainPreStartTelemetry()

  telemetry.setContextProvider(function () {
    return {
      application: {
        id: configuration.applicationId
      },
      session: {
        id: session.findTrackedSession() && session.findTrackedSession().id
      },
      view: {
        id: viewContexts.findView() && viewContexts.findView().id
      },
      action: {
        id: actionContexts.findActionId(),
        ids: actionContexts.findAllActionId()
      }
    }
  })
  const {
    addTiming,
    startView,
    setViewName,
    setViewContext,
    setViewContextProperty,
    getViewContext,
    stop: stopViewCollection
  } = startViewCollection(
    lifeCycle,
    configuration,
    location,
    domMutationObservable,
    locationChangeObservable,
    pageStateHistory,
    recorderApi,
    initialViewOptions
  )
  cleanupTasks.push(stopViewCollection)

  const _startResourceCollection = startResourceCollection(
    lifeCycle,
    configuration,
    pageStateHistory
  )
  var addResource = _startResourceCollection.addResource
  cleanupTasks.push(_startResourceCollection.stop)
  if (
    PerformanceObserver.supportedEntryTypes &&
    PerformanceObserver.supportedEntryTypes.includes(
      RumPerformanceEntryType.LONG_ANIMATION_FRAME
    )
  ) {
    var longAnimationFrameCollection = startLongAnimationFrameCollection(
      lifeCycle,
      configuration
    )
    cleanupTasks.push(longAnimationFrameCollection.stop)
  } else {
    startLongTaskCollection(lifeCycle, configuration)
  }

  var _startErrorCollection = startErrorCollection(
    lifeCycle,
    configuration,
    session,
    pageStateHistory
  )
  var addError = _startErrorCollection.addError
  startRequestCollection(lifeCycle, configuration, session)

  var internalContext = startInternalContext(
    configuration.applicationId,
    session,
    viewContexts,
    actionContexts,
    urlContexts
  )
  return {
    addResource: addResource,
    addAction: addAction,
    addError: addError,
    addTiming: addTiming,
    configuration: configuration,
    startView,
    setViewContext,
    setViewContextProperty,
    getViewContext,
    setViewName,
    lifeCycle: lifeCycle,
    viewContexts: viewContexts,
    session: session,
    setForcedSession: function () {
      session.setForcedSession()
    },
    stopSession: function () {
      session.expire()
    },
    getInternalContext: internalContext.get,
    stop: function () {
      cleanupTasks.forEach(function (task) {
        task()
      })
    }
  }
}
function startRumTelemetry(configuration) {
  const telemetry = startTelemetry(TelemetryService.RUM, configuration)
  //   if (canUseEventBridge()) {
  //     const bridge = getEventBridge()
  //     telemetry.observable.subscribe((event) =>
  //       bridge.send('internal_telemetry', event)
  //     )
  //   }
  return telemetry
}

export function startRumEventCollection(
  lifeCycle,
  configuration,
  location,
  sessionManager,
  userSessionManager,
  pageStateHistory,
  locationChangeObservable,
  domMutationObservable,
  getCommonContext,
  reportError
) {
  var viewContexts = startViewContexts(lifeCycle)
  var urlContexts = startUrlContexts(
    lifeCycle,
    locationChangeObservable,
    location
  )

  var _startActionCollection = startActionCollection(
    lifeCycle,
    domMutationObservable,
    configuration,
    pageStateHistory
  )
  var actionContexts = _startActionCollection.actionContexts
  var addAction = _startActionCollection.addAction

  var displayContext = startDisplayContext()
  startRumAssembly(
    configuration,
    lifeCycle,
    sessionManager,
    userSessionManager,
    viewContexts,
    urlContexts,
    actionContexts,
    displayContext,
    getCommonContext,
    reportError
  )
  return {
    viewContexts: viewContexts,
    urlContexts: urlContexts,
    pageStateHistory: pageStateHistory,
    addAction: addAction,
    actionContexts: actionContexts,
    stop: function () {
      displayContext.stop()
      pageStateHistory.stop()
      urlContexts.stop()
      viewContexts.stop()
    }
  }
}
