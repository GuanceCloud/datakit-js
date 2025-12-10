import {
  makePublicApi,
  createContextManager,
  CustomerDataType,
  clocksNow,
  ActionType,
  ResourceType,
  deepClone,
  createHandlingStack,
  sanitizeUser,
  checkUser,
  callMonitored,
  assign,
  monitor,
  storeContextManager,
  createIdentityEncoder,
  addTelemetryUsage,
  sanitize,
  createCustomerDataTrackerManager,
  CustomerDataCompressionStatus,
  displayAlreadyInitializedError,
  getType
} from '@cloudcare/browser-core'
import { buildCommonContext } from '../domain/contexts/commonContext'
import { createPreStartStrategy } from './perStartRum'
var RUM_STORAGE_KEY = 'rum'
export function makeRumPublicApi(startRumImpl, recorderApi, options) {
  if (options === undefined) {
    options = {}
  }
  const customerDataTrackerManager = createCustomerDataTrackerManager(
    CustomerDataCompressionStatus.Unknown
  )
  const globalContextManager = createContextManager('global', {
    customerDataTracker: customerDataTrackerManager.getOrCreateTracker(
      CustomerDataType.GlobalContext
    )
  })
  const userContextManager = createContextManager('user', {
    customerDataTracker: customerDataTrackerManager.getOrCreateTracker(
      CustomerDataType.User
    ),
    propertiesConfig: {
      id: { type: 'string' },
      name: { type: 'string' },
      email: { type: 'string' }
    }
  })
  function getCommonContext() {
    return buildCommonContext(
      globalContextManager,
      userContextManager,
      recorderApi
    )
  }
  let strategy = createPreStartStrategy(
    options,
    getCommonContext,
    function (configuration, deflateWorker, initialViewOptions) {
      if (configuration.storeContextsToLocal) {
        storeContextManager(
          configuration,
          globalContextManager,
          RUM_STORAGE_KEY,
          CustomerDataType.GlobalContext
        )
        storeContextManager(
          configuration,
          userContextManager,
          RUM_STORAGE_KEY,
          CustomerDataType.User
        )
      }
      customerDataTrackerManager.setCompressionStatus(
        deflateWorker
          ? CustomerDataCompressionStatus.Enabled
          : CustomerDataCompressionStatus.Disabled
      )
      var startRumResult = startRumImpl(
        configuration,
        recorderApi,
        customerDataTrackerManager,
        getCommonContext,
        initialViewOptions,
        deflateWorker && options.createDeflateEncoder
          ? function (streamId) {
              return options.createDeflateEncoder(deflateWorker, streamId)
            }
          : createIdentityEncoder
      )
      recorderApi.onRumStart(
        startRumResult.lifeCycle,
        configuration,
        startRumResult.session,
        startRumResult.viewContexts,
        deflateWorker
      )

      strategy = createPostStartStrategy(strategy, startRumResult)

      return startRumResult
    }
  )

  const startView = monitor(function (options) {
    const sanitizedOptions =
      typeof options === 'object' ? options : { name: options }
    strategy.startView(sanitizedOptions)
    if (sanitizedOptions.context) {
      customerDataTrackerManager
        .getOrCreateTracker(CustomerDataType.View)
        .updateCustomerData(sanitizedOptions.context)
    }
    addTelemetryUsage({ feature: 'start-view' })
  })

  var rumPublicApi = makePublicApi({
    init: monitor(function (initConfiguration) {
      strategy.init(initConfiguration)
    }),
    setViewName: monitor((name) => {
      strategy.setViewName(name)
      addTelemetryUsage({ feature: 'set-view-name' })
    }),

    setViewContext: monitor((context) => {
      strategy.setViewContext(context)
      addTelemetryUsage({ feature: 'set-view-context' })
    }),

    setViewContextProperty: monitor((key, value) => {
      strategy.setViewContextProperty(key, value)
      addTelemetryUsage({ feature: 'set-view-context-property' })
    }),

    getViewContext: monitor(() => {
      addTelemetryUsage({ feature: 'set-view-context-property' })
      return strategy.getViewContext()
    }),
    /** @deprecated: use setGlobalContextProperty instead */
    addRumGlobalContext: monitor(function (key, value) {
      globalContextManager.setContextProperty(key, value)
      addTelemetryUsage({ feature: 'set-global-context' })
    }),
    setGlobalContextProperty: monitor(function (key, value) {
      globalContextManager.setContextProperty(key, value)
      addTelemetryUsage({ feature: 'set-global-context' })
    }),

    /** @deprecated: use removeGlobalContextProperty instead */
    removeRumGlobalContext: monitor(function (key) {
      return globalContextManager.removeContextProperty(key)
    }),
    removeGlobalContextProperty: monitor(function (key) {
      return globalContextManager.removeContextProperty(key)
    }),

    /** @deprecated: use getGlobalContext instead */
    getRumGlobalContext: monitor(function () {
      return globalContextManager.getContext()
    }),
    getGlobalContext: monitor(function () {
      return globalContextManager.getContext()
    }),

    /** @deprecated: use setGlobalContext instead */
    setRumGlobalContext: monitor(function (context) {
      globalContextManager.setContext(context)
      addTelemetryUsage({ feature: 'set-global-context' })
    }),
    setGlobalContext: monitor(function (context) {
      globalContextManager.setContext(context)
      addTelemetryUsage({ feature: 'set-global-context' })
    }),

    clearGlobalContext: monitor(function () {
      return globalContextManager.clearContext()
    }),

    getInitConfiguration: monitor(function () {
      return deepClone(strategy.initConfiguration)
    }),
    getRemoteConfiguration: monitor(function (callback) {
      return strategy.getRemoteConfiguration(callback)
    }),
    getInternalContext: monitor(function (startTime) {
      return strategy.getInternalContext(startTime)
    }),
    addDebugSession: monitor(function (id) {}),
    clearDebugSession: monitor(function () {}),
    getDebugSession: monitor(function () {}),
    addResource: monitor(function (context) {
      const handlingStack = createHandlingStack()
      callMonitored(function () {
        strategy.addResource({
          context: sanitize(context),
          startClocks: clocksNow(),
          type: ResourceType.CUSTOM,
          handlingStack: handlingStack
        })
        addTelemetryUsage({ feature: 'add-resource' })
      })
    }),
    addTypeAction: monitor(function (name, type, context) {
      const handlingStack = createHandlingStack()

      callMonitored(function () {
        const sourceType = sanitize(type)
        strategy.addAction({
          name: sanitize(name),
          context: sanitize(context),
          startClocks: clocksNow(),
          type:
            getType(sourceType) === 'string' ? sourceType : ActionType.CUSTOM,
          handlingStack: handlingStack
        })
        addTelemetryUsage({ feature: 'add-type-action' })
      })
    }),
    addAction: monitor(function (name, context) {
      const handlingStack = createHandlingStack()
      callMonitored(function () {
        strategy.addAction({
          name: sanitize(name),
          context: sanitize(context),
          startClocks: clocksNow(),
          type: ActionType.CUSTOM,
          handlingStack: handlingStack
        })
        addTelemetryUsage({ feature: 'add-action' })
      })
    }),
    addError: monitor(function (error, context) {
      var handlingStack = createHandlingStack()
      callMonitored(function () {
        strategy.addError({
          error, // Do not sanitize error here, it is needed unserialized by computeRawError()
          handlingStack,
          context: sanitize(context),
          startClocks: clocksNow()
        })
        addTelemetryUsage({ feature: 'add-error' })
      })
    }),
    addTiming: monitor(function (name, time) {
      strategy.addTiming(sanitize(name), time)
    }),
    setUser: monitor(function (newUser) {
      if (checkUser(newUser)) {
        userContextManager.setContext(sanitizeUser(newUser))
      }
      addTelemetryUsage({ feature: 'set-user' })
    }),
    getUser: monitor(function () {
      return userContextManager.getContext()
    }),
    setUserProperty: monitor(function (key, property) {
      var newUser = {}
      newUser[key] = property
      var sanitizedProperty = sanitizeUser(newUser)[key]
      userContextManager.setContextProperty(key, sanitizedProperty)
      addTelemetryUsage({ feature: 'set-user' })
    }),
    removeUserProperty: monitor(function (key) {
      return userContextManager.removeContextProperty(key)
    }),

    /** @deprecated: renamed to clearUser */
    removeUser: monitor(function () {
      return userContextManager.clearContext()
    }),
    clearUser: monitor(function () {
      return userContextManager.clearContext()
    }),
    startView: startView,
    stopSession: monitor(function () {
      strategy.stopSession()
      addTelemetryUsage({ feature: 'stop-session' })
    }),
    setForcedSession: monitor(function () {
      strategy.setForcedSession()
      addTelemetryUsage({ feature: 'set-forced-session' })
    }),
    startSessionReplayRecording: monitor(function (options) {
      recorderApi.start(options)
      addTelemetryUsage({
        feature: 'start-session-replay-recording',
        force: options && options.force
      })
    }),
    stopSessionReplayRecording: monitor(recorderApi.stop),
    takeSubsequentFullSnapshot: monitor(recorderApi.takeSubsequentFullSnapshot)
  })
  return rumPublicApi
}
function createPostStartStrategy(preStartStrategy, startRumResult) {
  return assign(
    {
      init: function (initConfiguration) {
        displayAlreadyInitializedError('DATAFLUX_RUM', initConfiguration)
      },
      initConfiguration: preStartStrategy.getInitConfiguration(),
      getRemoteConfiguration: function (callback) {
        preStartStrategy.getRemoteConfiguration(callback)
      }
    },
    startRumResult
  )
}
