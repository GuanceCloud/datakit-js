import {
  createBoundedBuffer,
  display,
  canUseEventBridge,
  displayAlreadyInitializedError,
  willSyntheticsInjectRum,
  noop,
  timeStampNow,
  clocksNow,
  assign,
  addTelemetryConfiguration,
  initFetchObservable,
  deepClone,
  fetchAndApplyRemoteConfiguration,
  getEventBridge
} from '@cloudcare/browser-core'
import { validateAndBuildRumConfiguration } from '../domain/configuration'

export function createPreStartStrategy(
  rumPublicApiOptions,
  getCommonContext,
  doStartRum
) {
  var ignoreInitIfSyntheticsWillInjectRum =
    rumPublicApiOptions.ignoreInitIfSyntheticsWillInjectRum
  var startDeflateWorker = rumPublicApiOptions.startDeflateWorker
  var bufferApiCalls = createBoundedBuffer()

  var firstStartViewCall

  var deflateWorker

  var cachedInitConfiguration
  var cachedConfiguration

  function tryStartRum() {
    if (!cachedInitConfiguration || !cachedConfiguration) {
      return
    }

    var initialViewOptions

    if (cachedConfiguration.trackViewsManually) {
      if (!firstStartViewCall) {
        return
      }
      // An initial view is always created when starting RUM.
      // When tracking views automatically, any startView call before RUM start creates an extra
      // view.
      // When tracking views manually, we use the ViewOptions from the first startView call as the
      // initial view options, and we remove the actual startView call so we don't create an extra
      // view.
      bufferApiCalls.remove(firstStartViewCall.callback)
      initialViewOptions = firstStartViewCall.options
    }

    var startRumResult = doStartRum(
      cachedConfiguration,
      deflateWorker,
      initialViewOptions
    )

    bufferApiCalls.drain(startRumResult)
  }

  function doInit(initConfiguration) {
    var eventBridgeAvailable = canUseEventBridge()
    if (eventBridgeAvailable) {
      initConfiguration = overrideInitConfigurationForBridge(initConfiguration)
    }

    // Update the exposed initConfiguration to reflect the bridge and remote configuration overrides
    cachedInitConfiguration = initConfiguration
    addTelemetryConfiguration(deepClone(initConfiguration))
    if (cachedConfiguration) {
      displayAlreadyInitializedError('DATAFLUX_RUM', initConfiguration)
      return
    }
    var configuration = validateAndBuildRumConfiguration(initConfiguration)
    if (!configuration) {
      return
    }

    if (!eventBridgeAvailable && !configuration.sessionStoreStrategyType) {
      display.warn(
        'No storage available for session. We will not send any data.'
      )
      return
    }

    if (
      configuration.compressIntakeRequests &&
      !configuration.sendContentTypeByJson &&
      !eventBridgeAvailable &&
      startDeflateWorker
    ) {
      deflateWorker = startDeflateWorker(
        configuration,
        'RUM',
        // Worker initialization can fail asynchronously, especially in Firefox where even CSP
        // issues are reported asynchronously. For now, the SDK will continue its execution even if
        // data won't be sent to Datadog. We could improve this behavior in the future.
        noop
      )
      if (!deflateWorker) {
        // `startDeflateWorker` should have logged an error message explaining the issue
        return
      }
    }

    cachedConfiguration = configuration
    // Instrumuent fetch to track network requests
    // This is needed in case the consent is not granted and some cutsomer
    // library (Apollo Client) is storing uninstrumented fetch to be used later
    // The subscrption is needed so that the instrumentation process is completed
    initFetchObservable().subscribe(noop)

    tryStartRum()
  }

  return {
    init: function (initConfiguration) {
      if (!initConfiguration) {
        display.error('Missing configuration')
        return
      }
      // Set the experimental feature flags as early as possible, so we can use them in most places

      // Expose the initial configuration regardless of initialization success.
      cachedInitConfiguration = initConfiguration
      // If we are in a Synthetics test configured to automatically inject a RUM instance, we want
      // to completely discard the customer application RUM instance by ignoring their init() call.
      // But, we should not ignore the init() call from the Synthetics-injected RUM instance, so the
      // internal `ignoreInitIfSyntheticsWillInjectRum` option is here to bypass this condition.
      if (ignoreInitIfSyntheticsWillInjectRum && willSyntheticsInjectRum()) {
        return
      }
      if (initConfiguration.remoteConfiguration) {
        fetchAndApplyRemoteConfiguration(initConfiguration, doInit)
      } else {
        doInit(initConfiguration)
      }
    },

    getInitConfiguration: function () {
      return cachedInitConfiguration
    },

    getInternalContext: noop,

    stopSession: noop,

    addTiming: function (name, time) {
      if (time === undefined) {
        time = timeStampNow()
      }
      bufferApiCalls.add(function (startRumResult) {
        startRumResult.addTiming(name, time)
      })
    },

    startView: function (options, startClocks) {
      if (startClocks === undefined) {
        startClocks = clocksNow()
      }
      const callback = function (startRumResult) {
        startRumResult.startView(options, startClocks)
      }
      bufferApiCalls.add(callback)

      if (!firstStartViewCall) {
        firstStartViewCall = { options: options, callback: callback }
        tryStartRum()
      }
    },
    setViewName(name) {
      bufferApiCalls.add((startRumResult) => startRumResult.setViewName(name))
    },

    setViewContext(context) {
      bufferApiCalls.add((startRumResult) =>
        startRumResult.setViewContext(context)
      )
    },

    setViewContextProperty(key, value) {
      bufferApiCalls.add((startRumResult) =>
        startRumResult.setViewContextProperty(key, value)
      )
    },

    getViewContext: () => {},

    addTypeAction: function (action, type, commonContext) {
      if (commonContext === undefined) {
        commonContext = getCommonContext()
      }
      bufferApiCalls.add(function (startRumResult) {
        startRumResult.addTypeAction(action, type, commonContext)
      })
    },
    addAction: function (action, commonContext) {
      if (commonContext === undefined) {
        commonContext = getCommonContext()
      }
      bufferApiCalls.add(function (startRumResult) {
        startRumResult.addAction(action, commonContext)
      })
    },

    addError: function (providedError, commonContext) {
      if (commonContext === undefined) {
        commonContext = getCommonContext()
      }
      bufferApiCalls.add(function (startRumResult) {
        startRumResult.addError(providedError, commonContext)
      })
    }
  }
}

function overrideInitConfigurationForBridge(initConfiguration) {
  return assign({}, initConfiguration, {
    applicationId: '00000000-aaaa-0000-aaaa-000000000000',
    clientToken: 'empty',
    sessionSampleRate: 100,
    defaultPrivacyLevel:
      initConfiguration.defaultPrivacyLevel ??
      getEventBridge()?.getPrivacyLevel()
  })
}
