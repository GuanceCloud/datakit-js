import { assign, clocksNow, createHandlingStack } from '@cloudcare/browser-core'

var activeRum
var activeConfiguration = {}
var activeAddError
var pendingInitCallbacks = []
var pendingStartCallbacks = []

export function angularPlugin(configuration) {
  if (configuration === undefined) {
    configuration = {}
  }

  return {
    name: 'angular',
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
        trackAngularRouter(configuration.router, activeRum, configuration)
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

export function addAngularError(error, context) {
  var providedError = {
    error: getOriginalError(error),
    handlingStack: createHandlingStack(),
    context: assignContext({ framework: 'angular' }, context),
    startClocks: clocksNow()
  }
  whenRumStarted(function (addError) {
    addError(providedError)
  })
}

export class RumAngularErrorHandler {
  constructor(delegate) {
    this.delegate = delegate
  }

  handleError(error) {
    addAngularError(error)
    if (this.delegate && typeof this.delegate.handleError === 'function') {
      return this.delegate.handleError(error)
    }
  }
}

export function createAngularErrorHandler(delegate) {
  return new RumAngularErrorHandler(delegate)
}

export function trackAngularRouter(router, rum, options) {
  if (options === undefined) {
    options = {}
  }
  if (!rum) {
    whenRumInitialized(function (configuration, publicApi) {
      if (configuration.router) {
        trackAngularRouter(
          router,
          publicApi,
          assign({}, configuration, options)
        )
      }
    })
    return
  }
  if (!router || !router.events || typeof router.events.subscribe !== 'function') {
    return
  }
  var currentPath
  if (router.navigated && router.routerState && router.routerState.snapshot) {
    var initialUrl = router.url || '/'
    currentPath = normalizePath(initialUrl)
    startAngularView(
      router.routerState.snapshot.root,
      initialUrl,
      rum,
      options
    )
  }

  return router.events.subscribe(function (event) {
    if (!isSuccessfulNavigationEvent(event, options)) {
      return
    }
    var url = event.urlAfterRedirects || event.url || router.url || '/'
    var path = normalizePath(url)
    if (path === currentPath) {
      return
    }
    currentPath = path

    var root =
      (event.state && event.state.root) ||
      (router.routerState &&
        router.routerState.snapshot &&
        router.routerState.snapshot.root)
    startAngularView(root, url, rum, options)
  })
}

export function computeAngularViewName(root) {
  var segments = []
  var current = root

  while (current) {
    var path = current.routeConfig && current.routeConfig.path
    if (path === '**') {
      var urlSegments = current.url || []
      for (var i = 0; i < urlSegments.length; i += 1) {
        if (urlSegments[i] && urlSegments[i].path) {
          segments.push(urlSegments[i].path)
        }
      }
      break
    }
    if (path) {
      segments.push(path)
    }
    current = getPrimaryChild(current.children || [])
  }

  return '/' + segments.join('/')
}

export function resetAngularPlugin() {
  activeRum = undefined
  activeConfiguration = {}
  activeAddError = undefined
  pendingInitCallbacks.length = 0
  pendingStartCallbacks.length = 0
}

function startAngularView(root, url, rum, options) {
  var name =
    typeof options.getViewName === 'function'
      ? options.getViewName(root, url)
      : computeAngularViewName(root)
  if (name === undefined) {
    return
  }
  rum.startView({
    name: name,
    url: url,
    context: {
      framework: 'angular',
      router: 'angular-router'
    }
  })
}

function isSuccessfulNavigationEvent(event, options) {
  if (!event) {
    return false
  }
  if (typeof options.navigationEventMatcher === 'function') {
    return options.navigationEventMatcher(event)
  }
  return (
    typeof event.id === 'number' &&
    typeof event.url === 'string' &&
    typeof event.urlAfterRedirects === 'string' &&
    event.state === undefined &&
    event.shouldActivate === undefined
  )
}

function getPrimaryChild(children) {
  var fallback
  for (var i = 0; i < children.length; i += 1) {
    if (children[i].outlet === 'primary') {
      return children[i]
    }
    if (children[i].outlet === undefined && !fallback) {
      fallback = children[i]
    }
  }
  return fallback
}

function getOriginalError(error) {
  var original = error
  var seen = []
  while (original && typeof original === 'object') {
    if (seen.indexOf(original) !== -1) {
      break
    }
    seen.push(original)
    var nested = original.ngOriginalError || original.originalError
    if (!nested) {
      break
    }
    original = nested
  }
  return original
}

function normalizePath(value) {
  var path = String(value).split('#')[0].split('?')[0]
  return path || '/'
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
  return value && typeof value === 'object' && value.events
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
