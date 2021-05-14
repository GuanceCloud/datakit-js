import {
  makePublicApi,
  checkCookiesAuthorized,
  checkIsNotLocalFile
} from '../core/init'
import BoundedBuffer from '../helper/boundedBuffer'
import { buildCookieOptions } from '../core/configuration'
import {
  createContextManager,
  isPercentage,
  clocksNow,
  extend2Lev
} from '../helper/tools'
import { ActionType } from '../helper/enums'
import { ErrorSource } from '../helper/errorTools'

export function makeRumPublicApi(startRumImpl) {
  var isAlreadyInitialized = false

  var globalContextManager = createContextManager()
  var user = {}

  var getInternalContextStrategy = function () {
    return undefined
  }

  var beforeInitAddTiming = new BoundedBuffer()
  var addTimingStrategy = function (name) {
    beforeInitAddTiming.add([name, clocksNow()])
  }

  var beforeInitAddAction = new BoundedBuffer()
  var addActionStrategy = function (action) {
    beforeInitAddAction.add([action, clonedCommonContext()])
  }

  var beforeInitAddError = new BoundedBuffer()
  var addErrorStrategy = function (providedError) {
    beforeInitAddError.add([providedError, clonedCommonContext()])
  }

  function clonedCommonContext() {
    return extend2Lev(
      {},
      {
        context: globalContextManager.get(),
        user: user
      }
    )
  }

  var rumPublicApi = makePublicApi({
    init: function (userConfiguration) {
      if (
        !checkCookiesAuthorized(buildCookieOptions(userConfiguration)) ||
        !checkIsNotLocalFile() ||
        !canInitRum(userConfiguration)
      ) {
        return
      }
      // if (userConfiguration.publicApiKey) {
      //   userConfiguration.clientToken = userConfiguration.publicApiKey
      // }

      var _startRumImpl = startRumImpl(userConfiguration, function () {
        return {
          user: user,
          context: globalContextManager.get
        }
      })
      var addActionStrategy = _startRumImpl.addAction
      var addErrorStrategy = _startRumImpl.addError
      var addTimingStrategy = _startRumImpl.addTiming
      getInternalContextStrategy = _startRumImpl.getInternalContext
      beforeInitAddAction.drain(([action, commonContext]) =>
        addActionStrategy(action, commonContext)
      )
      beforeInitAddError.drain(([error, commonContext]) =>
        addErrorStrategy(error, commonContext)
      )
      beforeInitAddTiming.drain(([name, endClocks]) =>
        addTimingStrategy(name, endClocks)
      )

      isAlreadyInitialized = true
    },

    addRumGlobalContext: globalContextManager.add,

    removeRumGlobalContext: globalContextManager.remove,

    getRumGlobalContext: globalContextManager.get,
    setRumGlobalContext: globalContextManager.set,

    getInternalContext: function (startTime) {
      return getInternalContextStrategy(startTime)
    },

    addAction: function (name, context) {
      addActionStrategy({
        name: name,
        context: extend2Lev({}, context),
        startClocks: clocksNow(),
        type: ActionType.CUSTOM
      })
    },

    /**
     * @deprecated use addAction instead
     */
    addUserAction: function (name, context) {
      rumPublicApi.addAction(name, context)
    },

    addError: function (error, context, source) {
      if (typeof source === 'undefined') {
        source = ErrorSource.CUSTOM
      }
      var checkedSource
      if (
        source === ErrorSource.CUSTOM ||
        source === ErrorSource.NETWORK ||
        source === ErrorSource.SOURCE
      ) {
        checkedSource = source
      } else {
        console.error(`DD_RUM.addError: Invalid source '${source}'`)
        checkedSource = ErrorSource.CUSTOM
      }
      addErrorStrategy({
        error: error,
        context: extend2Lev({}, context),
        source: checkedSource,
        startClocks: clocksNow()
      })
    },

    addTiming: function (name) {
      addTimingStrategy(name)
    },

    setUser: function (newUser) {
      var sanitizedUser = sanitizeUser(newUser)
      if (sanitizedUser) {
        user = sanitizedUser
      } else {
        console.error('Unsupported user:', newUser)
      }
    }
  })
  return rumPublicApi

  function sanitizeUser(newUser) {
    if (typeof newUser !== 'object' || !newUser) {
      return
    }
    var result = extend2Lev({}, newUser)
    if ('id' in result) {
      result.id = String(result.id)
    }
    if ('name' in result) {
      result.name = String(result.name)
    }
    if ('email' in result) {
      result.email = String(result.email)
    }
    return result
  }
  function canInitRum(userConfiguration) {
    if (isAlreadyInitialized) {
      console.error('DATAFLUX_RUM is already initialized.')
      return false
    }

    if (!userConfiguration.applicationId) {
      console.error(
        'Application ID is not configured, no RUM data will be collected.'
      )
      return false
    }
    if (!userConfiguration.datakitUrl && !userConfiguration.datakitOrigin) {
      console.error(
        'datakitOrigin is not configured, no RUM data will be collected.'
      )
      return false
    }
    if (
      userConfiguration.sampleRate !== undefined &&
      !isPercentage(userConfiguration.sampleRate)
    ) {
      console.error('Sample Rate should be a number between 0 and 100')
      return false
    }
    if (
      userConfiguration.resourceSampleRate !== undefined &&
      !isPercentage(userConfiguration.resourceSampleRate)
    ) {
      console.error('Resource Sample Rate should be a number between 0 and 100')
      return false
    }

    return true
  }
}
