import {
  clocksNow,
  createHandlingStack,
  setTimeout
} from '@cloudcare/browser-core'

var activeRum
var activeAddError
var pendingStartCallbacks = []

var TERMINAL_CATCH_ALL_PARAM = '(.*)*'
var NESTED_CATCH_ALL_PARAM = '([^/]*)*'
var NORMALIZE_NUXT_PATH_REGEXP =
  /\\(.)|:([\w.]+)(\(\.\*\)\*|\(\[\^\/\]\*\)\*|\?|\(\))?/g

export function nuxtRumPlugin(configuration) {
  if (!configuration || !configuration.router) {
    throw new Error('nuxtRumPlugin requires a Vue Router instance')
  }

  return {
    name: 'nuxt',
    onInit: function (context) {
      activeRum = getPublicApi(context)
      activeAddError = context.addError || activeAddError
      context.initConfiguration.trackViewsManually = true
      drainPendingErrors()

      startTrackingNuxtViews(activeRum, configuration.router, configuration)
      if (configuration.nuxtApp) {
        setupNuxtErrorHandling(configuration.nuxtApp, function (
          error,
          instance,
          info
        ) {
          queueNuxtError(error, instance, info)
        })
      }

    },
    onRumStart: function (context) {
      activeRum = getPublicApi(context) || activeRum
      activeAddError = context.addError || activeAddError
      drainPendingErrors()
    },
    getConfigurationTelemetry: function () {
      return {
        router: true,
        nuxt: true,
        error_handler: !!configuration.nuxtApp
      }
    }
  }
}

export function nuxtPlugin(configuration) {
  return nuxtRumPlugin(configuration)
}

export function addNuxtError(error, context) {
  queueNuxtError(error, null, '', context)
}

export function installNuxtErrorHandler(nuxtApp, rum) {
  return setupNuxtErrorHandling(nuxtApp, function (error, instance, info) {
    reportNuxtError(rum, error, instance, info)
  })
}

export function setupNuxtErrorHandling(nuxtApp, reportError) {
  if (!nuxtApp || !nuxtApp.vueApp || !nuxtApp.vueApp.config) {
    return
  }

  var vueApp = nuxtApp.vueApp
  var originalErrorHandler = vueApp.config.errorHandler
  var shouldCallOriginal = true
  var reportOnce = deduplicateByError(reportError)
  var cleanups = []

  var suspenseCleanup = addNuxtHook(
    nuxtApp,
    'app:suspense:resolve',
    function () {
      if (isNuxtDefaultErrorHandler(originalErrorHandler)) {
        shouldCallOriginal = false
      }
    }
  )
  if (typeof suspenseCleanup === 'function') {
    cleanups.push(suspenseCleanup)
  }

  var errorHandler = function (error, instance, info) {
    reportOnce(error, instance, info)
    if (shouldCallOriginal && typeof originalErrorHandler === 'function') {
      return originalErrorHandler.call(this, error, instance, info)
    }
  }
  vueApp.config.errorHandler = errorHandler

  var appErrorCleanup = addNuxtHook(nuxtApp, 'app:error', function (error) {
    reportOnce(getOriginalError(error), null, '')
  })
  if (typeof appErrorCleanup === 'function') {
    cleanups.push(appErrorCleanup)
  }

  return function () {
    if (vueApp.config.errorHandler === errorHandler) {
      vueApp.config.errorHandler = originalErrorHandler
    }
    for (var i = cleanups.length - 1; i >= 0; i -= 1) {
      cleanups[i]()
    }
  }
}

export function startTrackingNuxtViews(rum, router, options) {
  if (!rum || !router || typeof router.afterEach !== 'function') {
    return
  }
  if (options === undefined) {
    options = {}
  }

  var currentRoute = getCurrentRoute(router)
  var lastViewKey
  if (currentRoute && currentRoute.matched && currentRoute.matched.length) {
    startNuxtView(rum, currentRoute, options)
    lastViewKey = getRouteViewKey(currentRoute)
  }

  return router.afterEach(function (to, from, failure) {
    if (failure) {
      return
    }
    var fromHasMatches = from && from.matched && from.matched.length > 0
    if (
      fromHasMatches &&
      to.path === from.path &&
      getRouteHash(to) === getRouteHash(from)
    ) {
      return
    }

    var viewKey = getRouteViewKey(to)
    if (viewKey && viewKey === lastViewKey) {
      return
    }
    lastViewKey = viewKey
    startNuxtView(rum, to, options)
  })
}

export function trackNuxtRouter(router, rum, options) {
  return startTrackingNuxtViews(rum, router, options)
}

export function computeNuxtViewName(matched) {
  if (!matched) {
    return ''
  }
  for (var i = matched.length - 1; i >= 0; i -= 1) {
    if (matched[i].path) {
      return normalizeNuxtRoutePath(matched[i].path)
    }
  }
  return ''
}

export function normalizeNuxtRoutePath(path) {
  if (!path) {
    return path === '' ? '' : undefined
  }
  return String(path).replace(
    NORMALIZE_NUXT_PATH_REGEXP,
    function (match, escapedChar, paramName, suffix) {
      if (escapedChar !== undefined) {
        return escapedChar
      }
      if (!paramName) {
        return ''
      }
      if (
        suffix === TERMINAL_CATCH_ALL_PARAM ||
        suffix === NESTED_CATCH_ALL_PARAM
      ) {
        return '[...' + paramName + ']'
      }
      if (suffix === '?') {
        return '[[' + paramName + ']]'
      }
      return '[' + paramName + ']'
    }
  )
}

export function resetNuxtPlugin() {
  activeRum = undefined
  activeAddError = undefined
  pendingStartCallbacks.length = 0
}

function startNuxtView(rum, route, options) {
  var name =
    typeof options.getViewName === 'function'
      ? options.getViewName(route)
      : computeNuxtViewName(route.matched)
  if (name === undefined) {
    return
  }
  rum.startView({
    name: name,
    context: {
      framework: 'nuxt',
      router: 'vue-router'
    }
  })
}

function reportNuxtError(rum, error, instance, info) {
  if (!rum) {
    return
  }
  rum.addError(getOriginalError(error), {
    framework: 'nuxt',
    component_stack: buildComponentStack(instance, info)
  })
}

function queueNuxtError(error, instance, info, context) {
  var originalError = getOriginalError(error)
  var providedError = {
    error: originalError,
    handlingStack: createHandlingStack(),
    context: assignContext(
      {
        framework: 'nuxt',
        component_stack: buildComponentStack(instance, info)
      },
      context
    ),
    startClocks: clocksNow()
  }
  whenRumStarted(function (addError) {
    addError(providedError)
  })
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

function deduplicateByError(reportError) {
  var seen = typeof WeakSet === 'function' ? new WeakSet() : []
  return function (error, instance, info) {
    if (error && typeof error === 'object') {
      if (hasSeen(seen, error)) {
        return
      }
      remember(seen, error)
    }
    reportError(error, instance, info)
  }
}

function hasSeen(seen, error) {
  return typeof seen.has === 'function'
    ? seen.has(error)
    : seen.indexOf(error) !== -1
}

function remember(seen, error) {
  if (typeof seen.add === 'function') {
    seen.add(error)
  } else {
    seen.push(error)
  }
  setTimeout(function () {
    forget(seen, error)
  }, 0)
}

function forget(seen, error) {
  if (typeof seen.delete === 'function') {
    seen.delete(error)
    return
  }
  var index = seen.indexOf(error)
  if (index !== -1) {
    seen.splice(index, 1)
  }
}

function isNuxtDefaultErrorHandler(errorHandler) {
  return !!errorHandler && errorHandler.__nuxt_default === true
}

function addNuxtHook(nuxtApp, name, callback) {
  if (typeof nuxtApp.hook === 'function') {
    return nuxtApp.hook(name, callback)
  }
  if (nuxtApp.hooks && typeof nuxtApp.hooks.hook === 'function') {
    return nuxtApp.hooks.hook(name, callback)
  }
}

function getOriginalError(error) {
  return (error && error.error) || error
}

function getCurrentRoute(router) {
  return router.currentRoute && (router.currentRoute.value || router.currentRoute)
}

function getRouteViewKey(route) {
  if (!route) {
    return undefined
  }
  return String(route.path || '') + getRouteHash(route)
}

function getRouteHash(route) {
  if (route.hash) {
    return route.hash
  }
  if (typeof route.fullPath === 'string') {
    var hashIndex = route.fullPath.indexOf('#')
    return hashIndex === -1 ? '' : route.fullPath.slice(hashIndex)
  }
  return ''
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
