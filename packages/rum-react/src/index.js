import React from 'react'
import { clocksNow, createHandlingStack } from '@cloudcare/browser-core'

var activeRum
var activeConfiguration = {}
var activeAddError
var pendingInitCallbacks = []
var pendingStartCallbacks = []

export function reactPlugin(configuration) {
  if (configuration === undefined) {
    configuration = {}
  }

  return {
    name: 'react',
    onInit: function (context) {
      activeRum = getPublicApi(context)
      activeConfiguration = configuration
      activeAddError = context.addError || activeAddError

      if (configuration.router) {
        context.initConfiguration.trackViewsManually = true
      }

      drainCallbacks(pendingInitCallbacks, function (callback) {
        callback(activeConfiguration, activeRum)
      })
      drainPendingErrors()

      if (isRouter(configuration.router)) {
        trackReactRouter(configuration.router, activeRum, configuration)
      }
    },
    onRumStart: function (context) {
      activeRum = getPublicApi(context) || activeRum
      activeAddError = context.addError || activeAddError
      drainPendingErrors()
    },
    getConfigurationTelemetry: function () {
      return { router: !!configuration.router }
    }
  }
}

export function addReactError(error, errorInfo, context) {
  var providedError = {
    error: error,
    handlingStack: createHandlingStack(),
    context: buildReactErrorContext(error, errorInfo, context),
    startClocks: clocksNow()
  }
  whenRumStarted(function (addError) {
    addError(providedError)
  })
}

export function createErrorBoundary(reportError, displayName) {
  if (reportError === undefined) {
    reportError = addReactError
  }
  if (displayName === undefined) {
    displayName = 'RumErrorBoundary'
  }

  class RumErrorBoundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { error: null }
      this.resetError = this.resetError.bind(this)
    }

    static getDerivedStateFromError(error) {
      return { error: error }
    }

    componentDidCatch(error, errorInfo) {
      reportError(error, errorInfo, this.props.context)
      if (this.props.onError) {
        this.props.onError(error, errorInfo)
      }
    }

    resetError() {
      this.setState({ error: null })
      if (this.props.onReset) {
        this.props.onReset()
      }
    }

    render() {
      if (!this.state.error) {
        return this.props.children
      }

      var fallbackProps = {
        error: this.state.error,
        resetError: this.resetError
      }
      if (typeof this.props.fallback === 'function') {
        return React.createElement(this.props.fallback, fallbackProps)
      }
      return this.props.fallback || null
    }
  }

  RumErrorBoundary.displayName = displayName
  return RumErrorBoundary
}

export var ErrorBoundary = createErrorBoundary()

export function resetReactPlugin() {
  activeRum = undefined
  activeConfiguration = {}
  activeAddError = undefined
  pendingInitCallbacks.length = 0
  pendingStartCallbacks.length = 0
}

export function trackReactRouter(router, rum, options) {
  if (options === undefined) {
    options = {}
  }
  if (!router || !rum) {
    return
  }

  var lastPathname
  var trackState = function (state) {
    var location = getRouterLocation(state)
    var pathname = getPathname(location)
    if (pathname === undefined || pathname === lastPathname) {
      return
    }
    lastPathname = pathname

    var matches = state && state.matches
    var viewName =
      typeof options.getViewName === 'function'
        ? options.getViewName(location, matches)
        : computeReactRouterViewName(matches, pathname)
    if (viewName === undefined) {
      return
    }
    rum.startView({
      name: viewName,
      context: {
        framework: 'react',
        router: 'react-router'
      }
    })
  }

  if (router.state) {
    trackState(router.state)
  } else if (router.location) {
    trackState(router)
  }

  if (typeof router.subscribe === 'function') {
    return router.subscribe(function (state) {
      trackState(state)
    })
  }
  if (typeof router.listen === 'function') {
    return router.listen(function (update) {
      trackState(update && (update.location || update))
    })
  }
}

export function wrapCreateReactRouter(createRouter, options) {
  if (typeof createRouter !== 'function') {
    throw new Error('A React Router create function is required')
  }

  return function () {
    var router = createRouter.apply(this, arguments)
    whenRumInitialized(function (configuration, rum) {
      if (!configuration.router) {
        return
      }
      trackReactRouter(router, rum, options || configuration)
    })
    return router
  }
}

export function computeReactRouterViewName(matches, fallbackPathname) {
  if (!matches || matches.length === 0) {
    return fallbackPathname === undefined
      ? ''
      : normalizePath(fallbackPathname)
  }

  var viewName = '/'
  for (var i = 0; i < matches.length; i += 1) {
    var route = matches[i].route || matches[i]
    var path = route.path
    if (!path) {
      continue
    }
    path = substitutePathSplats(
      path,
      matches[i].params || {},
      i === matches.length - 1
    )
    if (path.indexOf('/') === 0) {
      viewName = path
    } else {
      if (viewName.charAt(viewName.length - 1) !== '/') {
        viewName += '/'
      }
      viewName += path
    }
  }
  return viewName
}

function substitutePathSplats(path, params, isLastMatch) {
  if (path.indexOf('*') === -1 || params['*'] === undefined) {
    return path
  }
  if (isLastMatch) {
    return path.replace('*', params['*'])
  }
  return path.replace(/\/?\*/, '')
}

function buildReactErrorContext(error, errorInfo, context) {
  var reactContext = {
    framework: 'react'
  }
  if (errorInfo && errorInfo.componentStack) {
    reactContext.component_stack = errorInfo.componentStack
  }
  if (error && typeof error === 'object' && error.df_context) {
    reactContext = assignContext(reactContext, error.df_context)
  }
  return assignContext(reactContext, context)
}

function whenRumInitialized(callback) {
  if (activeRum) {
    callback(activeConfiguration, activeRum)
  } else {
    pendingInitCallbacks.push(callback)
  }
}

function whenRumStarted(callback) {
  if (activeAddError) {
    callback(activeAddError)
  } else {
    pendingStartCallbacks.push(callback)
  }
}

function drainPendingErrors() {
  if (activeAddError) {
    drainCallbacks(pendingStartCallbacks, function (callback) {
      callback(activeAddError)
    })
  }
}

function drainCallbacks(callbacks, invoke) {
  var pending = callbacks.splice(0, callbacks.length)
  for (var i = 0; i < pending.length; i += 1) {
    invoke(pending[i])
  }
}

function getPublicApi(context) {
  return context && (context.publicApi || context.rum)
}

function isRouter(value) {
  return (
    value &&
    typeof value === 'object' &&
    (typeof value.subscribe === 'function' ||
      typeof value.listen === 'function')
  )
}

function getRouterLocation(state) {
  return state && (state.location || state)
}

function getPathname(location) {
  if (!location) {
    return undefined
  }
  if (typeof location === 'string') {
    return normalizePath(location)
  }
  return location.pathname
}

function normalizePath(value) {
  var path = String(value).split('#')[0].split('?')[0]
  path = path.replace(/^[a-zA-Z][a-zA-Z\d+\-.]*:\/\/[^/]+/, '')
  return path || '/'
}

function assignContext(base, extra) {
  if (!extra) {
    return base
  }
  var result = {}
  var key
  for (key in base) {
    result[key] = base[key]
  }
  for (key in extra) {
    result[key] = extra[key]
  }
  return result
}
