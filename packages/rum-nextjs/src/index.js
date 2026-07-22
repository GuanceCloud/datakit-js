'use client'

import { useEffect, useRef } from 'react'
import { useParams, usePathname } from 'next/navigation'
import { useRouter } from 'next/router'
import { createErrorBoundary } from '@cloudcare/browser-rum-react'
import { clocksNow, createHandlingStack } from '@cloudcare/browser-core'

var activeRum
var activeConfiguration = {}
var activeAddError
var pendingInitCallbacks = []
var pendingStartCallbacks = []
var lastNavigationUrl
var lastStartedPath
var lastStartedViewName

export function nextjsPlugin(configuration) {
  if (configuration === undefined) {
    configuration = {}
  }

  return {
    name: 'nextjs',
    onInit: function (context) {
      activeRum = getPublicApi(context)
      activeConfiguration = configuration
      activeAddError = context.addError || activeAddError
      context.initConfiguration.trackViewsManually = true

      drainCallbacks(pendingInitCallbacks, function (callback) {
        callback(activeRum)
      })
      drainPendingErrors()

      if (configuration.router) {
        trackNextjsRouter(configuration.router, activeRum, configuration)
      } else {
        startInitialAppRouterView()
      }
    },
    onRumStart: function (context) {
      activeRum = getPublicApi(context) || activeRum
      activeAddError = context.addError || activeAddError
      drainPendingErrors()
    },
    getConfigurationTelemetry: function () {
      return {
        app_router: !configuration.router,
        pages_router: !!configuration.router
      }
    }
  }
}

export function onRouterTransitionStart(url) {
  lastNavigationUrl = url
  var path = normalizePath(url)
  if (activeRum && !activeConfiguration.router) {
    if (path !== lastStartedPath) {
      startNextjsView(undefined, url, activeRum)
    } else {
      lastNavigationUrl = undefined
    }
  }
}

export function startNextjsView(viewName, url, rum) {
  var startView = function (targetRum) {
    var viewUrl = url || lastNavigationUrl
    lastNavigationUrl = undefined
    lastStartedPath = normalizePath(viewUrl || viewName)
    lastStartedViewName = viewName
    targetRum.startView({
      name: viewName,
      url: viewUrl ? makeAbsoluteUrl(viewUrl) : undefined,
      context: {
        framework: 'nextjs',
        router: 'next-router'
      }
    })
  }
  if (rum) {
    startView(rum)
  } else {
    whenRumInitialized(startView)
  }
}

export function addNextjsError(error, errorInfo, context) {
  var providedError = {
    error: error,
    handlingStack: createHandlingStack(),
    context: buildNextjsErrorContext(error, errorInfo, context),
    startClocks: clocksNow()
  }
  whenRumStarted(function (addError) {
    addError(providedError)
  })
}

export var ErrorBoundary = createErrorBoundary(
  addNextjsError,
  'RumNextjsErrorBoundary'
)

export function RumNextjsAppRouter() {
  var pathname = usePathname()
  var params = useParams() || {}
  var previousPathname = useRef(null)
  var viewName = pathname
    ? computeViewNameFromParams(pathname, params)
    : undefined

  useEffect(
    function () {
      if (pathname && previousPathname.current !== pathname) {
        previousPathname.current = pathname
        updateNextjsView(normalizePath(pathname), viewName, pathname)
      }
    },
    [pathname, viewName]
  )
  return null
}

export function RumNextjsPagesRouter() {
  var router = useRouter()
  var previousPath = useRef(null)
  var path = router && router.isReady ? normalizePath(router.asPath) : undefined
  var viewName = router && (router.pathname || path)
  var viewUrl = router && router.asPath

  useEffect(
    function () {
      if (!router || !router.events || typeof router.events.on !== 'function') {
        return
      }
      var handleRouteChangeStart = function (url) {
        onRouterTransitionStart(url)
      }
      router.events.on('routeChangeStart', handleRouteChangeStart)
      return function () {
        if (typeof router.events.off === 'function') {
          router.events.off('routeChangeStart', handleRouteChangeStart)
        }
      }
    },
    [router]
  )

  useEffect(
    function () {
      if (path && previousPath.current !== path) {
        previousPath.current = path
        updateNextjsView(path, viewName, viewUrl)
      }
    },
    [path, viewName, viewUrl]
  )
  return null
}

export function trackNextjsRouter(router, rum, options) {
  if (options === undefined) {
    options = {}
  }
  if (!router || !rum) {
    return
  }

  var lastPath
  var startTransition = function (url) {
    var path = normalizePath(url || router.asPath || router.pathname)
    if (path === lastPath) {
      return
    }
    lastPath = path
    startNextjsView(undefined, url, rum)
  }
  var completeTransition = function (url) {
    var path = normalizePath(url || router.asPath || router.pathname)
    lastPath = path
    var name =
      typeof options.getViewName === 'function'
        ? options.getViewName(url, router)
        : router.pathname || path
    updateNextjsView(path, name, url, rum)
  }

  if (router.isReady && (router.asPath || router.pathname)) {
    completeTransition(router.asPath || router.pathname)
  }

  if (!router.events || typeof router.events.on !== 'function') {
    return
  }
  router.events.on('routeChangeStart', startTransition)
  router.events.on('routeChangeComplete', completeTransition)
  if (typeof router.events.off === 'function') {
    return function () {
      router.events.off('routeChangeStart', startTransition)
      router.events.off('routeChangeComplete', completeTransition)
    }
  }
}

export function computeViewNameFromParams(pathname, params) {
  if (!params || Object.keys(params).length === 0) {
    return pathname
  }

  var segments = pathname.split('/')
  var entries = Object.keys(params)
  var i
  for (i = 0; i < entries.length; i += 1) {
    var catchAllName = entries[i]
    var catchAllValue = params[catchAllName]
    if (!Array.isArray(catchAllValue) || catchAllValue.length === 0) {
      continue
    }
    for (var segmentIndex = 0; segmentIndex < segments.length; segmentIndex += 1) {
      if (matchesSegments(segments, segmentIndex, catchAllValue)) {
        segments.splice(
          segmentIndex,
          catchAllValue.length,
          '[...' + catchAllName + ']'
        )
        break
      }
    }
  }

  for (i = 0; i < entries.length; i += 1) {
    var name = entries[i]
    var value = params[name]
    if (typeof value !== 'string' || !value) {
      continue
    }
    var index = segments.indexOf(value)
    if (index !== -1) {
      segments[index] = '[' + name + ']'
    }
  }
  return segments.join('/')
}

export function resetNextjsPlugin() {
  activeRum = undefined
  activeConfiguration = {}
  activeAddError = undefined
  pendingInitCallbacks.length = 0
  pendingStartCallbacks.length = 0
  lastNavigationUrl = undefined
  lastStartedPath = undefined
  lastStartedViewName = undefined
}

function startInitialAppRouterView() {
  if (
    !activeRum ||
    lastStartedPath !== undefined ||
    typeof window === 'undefined'
  ) {
    return
  }
  var url =
    window.location.pathname + window.location.search + window.location.hash
  startNextjsView(undefined, url, activeRum)
}

function updateNextjsView(path, viewName, viewUrl, rum) {
  var targetRum = rum || activeRum
  if (path !== lastStartedPath) {
    startNextjsView(viewName, viewUrl, targetRum)
    return
  }
  if (
    viewName !== lastStartedViewName &&
    targetRum &&
    typeof targetRum.setViewName === 'function'
  ) {
    targetRum.setViewName(viewName)
    lastStartedViewName = viewName
  }
}

function matchesSegments(segments, startIndex, values) {
  if (startIndex + values.length > segments.length) {
    return false
  }
  for (var i = 0; i < values.length; i += 1) {
    if (segments[startIndex + i] !== values[i]) {
      return false
    }
  }
  return true
}

function buildNextjsErrorContext(error, errorInfo, context) {
  var nextContext = {
    framework: 'nextjs'
  }
  if (errorInfo && errorInfo.componentStack) {
    nextContext.component_stack = errorInfo.componentStack
  }
  var digest =
    (error && typeof error === 'object' && error.digest) ||
    (errorInfo && errorInfo.digest)
  if (digest) {
    nextContext.digest = digest
  }
  if (error && typeof error === 'object' && error.df_context) {
    nextContext = assignContext(nextContext, error.df_context)
  }
  return assignContext(nextContext, context)
}

function whenRumInitialized(callback) {
  if (activeRum) {
    callback(activeRum)
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

function makeAbsoluteUrl(url) {
  try {
    return new URL(url, window.location.origin).href
  } catch (error) {
    return url
  }
}

function normalizePath(value) {
  var path = String(value || '/').split('#')[0].split('?')[0]
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
