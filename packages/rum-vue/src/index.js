import { clocksNow, createHandlingStack } from '@cloudcare/browser-core'

var activeRum
var activeConfiguration = {}
var activeAddError
var pendingInitCallbacks = []
var pendingStartCallbacks = []

export function vuePlugin(configuration) {
  if (configuration === undefined) {
    configuration = {}
  }

  return {
    name: 'vue',
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

      if (configuration.app) {
        installVueErrorHandler(configuration.app)
      }
      if (isRouter(configuration.router)) {
        trackVueRouter(configuration.router, activeRum, configuration)
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

export function addVueError(error, instance, info, context) {
  var providedError = {
    error: error,
    handlingStack: createHandlingStack(),
    context: buildVueErrorContext(error, instance, info, context),
    startClocks: clocksNow()
  }
  whenRumStarted(function (addError) {
    addError(providedError)
  })
}

export function installVueErrorHandler(app, rum) {
  if (!app || !app.config) {
    return
  }

  var previousErrorHandler = app.config.errorHandler
  var errorHandler = function (error, instance, info) {
    if (rum) {
      rum.addError(error, buildVueErrorContext(error, instance, info))
    } else {
      addVueError(error, instance, info)
    }
    if (typeof previousErrorHandler === 'function') {
      return previousErrorHandler.call(this, error, instance, info)
    }
  }
  app.config.errorHandler = errorHandler

  return function () {
    if (app.config.errorHandler === errorHandler) {
      app.config.errorHandler = previousErrorHandler
    }
  }
}

export function trackVueRouter(router, rum, options) {
  if (options === undefined) {
    options = {}
  }
  if (!router || !rum || typeof router.afterEach !== 'function') {
    return
  }

  var lastPath
  var currentRoute = getCurrentRoute(router)
  if (currentRoute && currentRoute.matched && currentRoute.matched.length) {
    startVueView(currentRoute, rum, options)
    lastPath = currentRoute.path
  }

  return router.afterEach(function (to, from, failure) {
    if (failure) {
      return
    }
    var fromHasMatches = from && from.matched && from.matched.length > 0
    if (
      (fromHasMatches && to.path === from.path) ||
      (lastPath !== undefined && to.path === lastPath)
    ) {
      return
    }
    lastPath = to.path
    startVueView(to, rum, options)
  })
}

export function wrapCreateVueRouter(createRouter, options) {
  if (typeof createRouter !== 'function') {
    throw new Error('A Vue Router create function is required')
  }

  return function () {
    var router = createRouter.apply(this, arguments)
    whenRumInitialized(function (configuration, rum) {
      if (!configuration.router) {
        return
      }
      trackVueRouter(router, rum, options || configuration)
    })
    return router
  }
}

export function computeVueRouterViewName(matched, path) {
  if (!matched || matched.length === 0) {
    return ''
  }

  var viewName = '/'
  for (var i = 0; i < matched.length; i += 1) {
    var routePath = matched[i].path
    if (!routePath) {
      continue
    }
    if (routePath.indexOf('/') === 0) {
      viewName = routePath
    } else {
      if (viewName.charAt(viewName.length - 1) !== '/') {
        viewName += '/'
      }
      viewName += routePath
    }
  }
  return substituteCatchAll(viewName, path)
}

export function resetVuePlugin() {
  activeRum = undefined
  activeConfiguration = {}
  activeAddError = undefined
  pendingInitCallbacks.length = 0
  pendingStartCallbacks.length = 0
}

function startVueView(route, rum, options) {
  var name
  if (typeof options.getViewName === 'function') {
    name = options.getViewName(route)
  } else if (route.meta && route.meta.rumViewName) {
    name = route.meta.rumViewName
  } else {
    name = computeVueRouterViewName(route.matched, route.path)
  }
  if (name === undefined) {
    return
  }
  rum.startView({
    name: name,
    context: {
      framework: 'vue',
      router: 'vue-router'
    }
  })
}

function substituteCatchAll(viewName, path) {
  var pattern = '/:pathMatch(.*)*'
  var catchAllIndex = viewName.indexOf(pattern)
  if (catchAllIndex === -1) {
    return viewName
  }

  var prefix = viewName.slice(0, catchAllIndex)
  var prefixSegmentCount = prefix ? prefix.split('/').length - 1 : 0
  var pathSegments = String(path || '').split('/')
  var suffix = pathSegments.slice(prefixSegmentCount + 1).join('/')
  return prefix + (suffix ? '/' + suffix : '') || '/'
}

function buildVueErrorContext(error, instance, info, context) {
  var vueContext = {
    framework: 'vue',
    component_stack: buildComponentStack(instance, info)
  }
  if (error && typeof error === 'object' && error.df_context) {
    vueContext = assignContext(vueContext, error.df_context)
  }
  return assignContext(vueContext, context)
}

function buildComponentStack(instance, info) {
  var parts = []
  if (info) {
    parts.push(info)
  }

  var current = instance && (instance.$ || instance)
  while (current) {
    var type = current.type || current.$options || {}
    var name = type.name || type.__name || type._componentTag
    if (name) {
      parts.push('at <' + name + '>')
    }
    current = current.parent || current.$parent
  }
  return parts.length ? parts.join('\n') : undefined
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

function getCurrentRoute(router) {
  if (!router.currentRoute) {
    return undefined
  }
  return router.currentRoute.value || router.currentRoute
}

function getPublicApi(context) {
  return context && (context.publicApi || context.rum)
}

function isRouter(value) {
  return value && typeof value === 'object' && typeof value.afterEach === 'function'
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
