import {
  createContextManager,
  makePublicApi,
  CustomerDataType,
  checkUser,
  sanitizeUser,
  monitor,
  storeContextManager,
  displayAlreadyInitializedError,
  assign,
  createCustomerDataTrackerManager,
  deepClone
} from '@cloudcare/browser-core'
import { Logger } from '../domain/logger'
import { buildCommonContext } from '../domain/contexts/commonContext'
import { createPreStartStrategy } from './preStartLogs'
var LOGS_STORAGE_KEY = 'logs'
export function makeLogsPublicApi(startLogsImpl) {
  const customerDataTrackerManager = createCustomerDataTrackerManager()
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
    return buildCommonContext(globalContextManager, userContextManager)
  }
  var strategy = createPreStartStrategy(
    getCommonContext,
    function (initConfiguration, configuration) {
      if (initConfiguration.storeContextsToLocal) {
        storeContextManager(
          configuration,
          globalContextManager,
          LOGS_STORAGE_KEY,
          CustomerDataType.GlobalContext
        )
        storeContextManager(
          configuration,
          userContextManager,
          LOGS_STORAGE_KEY,
          CustomerDataType.User
        )
      }

      var startLogsResult = startLogsImpl(
        initConfiguration,
        configuration,
        getCommonContext
      )

      strategy = createPostStartStrategy(initConfiguration, startLogsResult)
      return startLogsResult
    }
  )
  var customLoggers = {}

  var mainLogger = new Logger(
    (...params) => strategy.handleLog(...params),
    customerDataTrackerManager.createDetachedTracker()
  )

  return makePublicApi({
    logger: mainLogger,

    init: monitor(function (initConfiguration) {
      return strategy.init(initConfiguration)
    }),

    getGlobalContext: monitor(function () {
      return globalContextManager.getContext()
    }),

    setGlobalContext: monitor(function (context) {
      return globalContextManager.setContext(context)
    }),

    setGlobalContextProperty: monitor(function (key, value) {
      return globalContextManager.setContextProperty(key, value)
    }),

    removeGlobalContextProperty: monitor(function (key) {
      return globalContextManager.removeContextProperty(key)
    }),

    clearGlobalContext: monitor(function () {
      return globalContextManager.clearContext()
    }),

    createLogger: monitor(function (name, conf) {
      if (typeof conf == 'undefined') {
        conf = {}
      }
      customLoggers[name] = new Logger(
        (...params) => strategy.handleLog(...params),
        customerDataTrackerManager.createDetachedTracker(),
        sanitize(name),
        conf.handler,
        conf.level,
        sanitize(conf.context)
      )
      return customLoggers[name]
    }),

    getLogger: monitor(function (name) {
      return customLoggers[name]
    }),

    getInitConfiguration: monitor(function () {
      return deepClone(strategy.initConfiguration)
    }),

    getInternalContext: monitor(function (startTime) {
      return strategy.getInternalContext(startTime)
    }),
    setUser: monitor(function (newUser) {
      if (checkUser(newUser)) {
        userContextManager.setContext(newUser)
      }
    }),
    getUser: monitor(function () {
      return userContextManager.getContext()
    }),
    removeUserProperty: monitor(function (key) {
      return userContextManager.removeContextProperty(key)
    }),
    setUserProperty: monitor(function (key, property) {
      userContextManager.setContextProperty(key, property)
    }),
    clearUser: monitor(function () {
      return userContextManager.clearContext()
    })
  })
}
function createPostStartStrategy(initConfiguration, startLogsResult) {
  return assign(
    {
      init: function (initConfiguration) {
        displayAlreadyInitializedError('DATAFLUX_LOGS', initConfiguration)
      },
      initConfiguration: initConfiguration
    },
    startLogsResult
  )
}
