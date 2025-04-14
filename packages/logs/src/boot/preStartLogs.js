import {
  createBoundedBuffer,
  assign,
  canUseEventBridge,
  display,
  displayAlreadyInitializedError,
  initFetchObservable,
  noop,
  timeStampNow
} from '@cloudcare/browser-core'
import { validateAndBuildLogsConfiguration } from '../domain/configuration'

export function createPreStartStrategy(getCommonContext, doStartLogs) {
  const bufferApiCalls = createBoundedBuffer()
  let cachedInitConfiguration
  let cachedConfiguration

  function tryStartLogs() {
    if (!cachedConfiguration || !cachedInitConfiguration) {
      return
    }

    var startLogsResult = doStartLogs(
      cachedInitConfiguration,
      cachedConfiguration
    )
    bufferApiCalls.drain(startLogsResult)
  }

  return {
    init: function (initConfiguration) {
      if (!initConfiguration) {
        display.error('Missing configuration')
        return
      }
      // Set the experimental feature flags as early as possible, so we can use them in most places

      if (canUseEventBridge()) {
        initConfiguration =
          overrideInitConfigurationForBridge(initConfiguration)
      }

      // Expose the initial configuration regardless of initialization success.
      cachedInitConfiguration = initConfiguration

      if (cachedConfiguration) {
        displayAlreadyInitializedError('DATAFLUX_LOGS', initConfiguration)
        return
      }

      const configuration = validateAndBuildLogsConfiguration(initConfiguration)
      if (!configuration) {
        return
      }

      cachedConfiguration = configuration
      // Instrumuent fetch to track network requests
      // This is needed in case the consent is not granted and some cutsomer
      // library (Apollo Client) is storing uninstrumented fetch to be used later
      // The subscrption is needed so that the instrumentation process is completed
      initFetchObservable().subscribe(noop)

      tryStartLogs()
    },

    getInitConfiguration: function () {
      return cachedInitConfiguration
    },

    getInternalContext: noop,

    handleLog: function (message, statusType, handlingStack, context, date) {
      if (context === undefined) {
        context = getCommonContext()
      }
      if (date === undefined) {
        date = timeStampNow()
      }
      bufferApiCalls.add(function (startLogsResult) {
        startLogsResult.handleLog(
          message,
          statusType,
          handlingStack,
          context,
          date
        )
      })
    }
  }
}

function overrideInitConfigurationForBridge(initConfiguration) {
  return assign({}, initConfiguration, { clientToken: 'empty' })
}
