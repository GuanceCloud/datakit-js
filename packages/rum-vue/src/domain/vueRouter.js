import { onRumInit } from './pluginState'

export function wrapCreateRouter(createRouter) {
  if (typeof createRouter !== 'function') {
    throw new Error('A Vue Router create function is required')
  }

  return function () {
    var router = createRouter.apply(this, arguments)
    instrumentRouter(router)
    return router
  }
}

export function wrapRouterConstructor(Router) {
  if (typeof Router !== 'function') {
    throw new Error('A Vue Router constructor is required')
  }

  function InstrumentedRouter(options) {
    var router = new Router(options)
    instrumentRouter(router)
    return router
  }

  InstrumentedRouter.prototype = Router.prototype
  copyConstructorProperties(Router, InstrumentedRouter)
  return InstrumentedRouter
}

export function startVueRouterView(route) {
  onRumInit(function (configuration, rum) {
    if (!configuration.router) {
      return
    }

    var name
    if (typeof configuration.getViewName === 'function') {
      name = configuration.getViewName(route)
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
  })
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

function instrumentRouter(router) {
  if (!router || typeof router.afterEach !== 'function') {
    throw new Error('A Vue Router instance is required')
  }

  var lastPath
  var currentRoute = getCurrentRoute(router)
  if (hasMatches(currentRoute)) {
    lastPath = currentRoute.path
    startVueRouterView(currentRoute)
  }

  router.afterEach(function (to, from, failure) {
    if (failure) {
      return
    }
    if (
      (hasMatches(from) && to.path === from.path) ||
      (lastPath !== undefined && to.path === lastPath)
    ) {
      return
    }
    lastPath = to.path
    startVueRouterView(to)
  })
}

function hasMatches(route) {
  return route && route.matched && route.matched.length > 0
}

function getCurrentRoute(router) {
  if (!router.currentRoute) {
    return undefined
  }
  return router.currentRoute.value || router.currentRoute
}

function substituteCatchAll(viewName, path) {
  var vue4Pattern = '/:pathMatch(.*)*'
  var vue4Index = viewName.indexOf(vue4Pattern)
  if (vue4Index !== -1) {
    return substitutePathSuffix(viewName, path, vue4Index, vue4Pattern.length)
  }

  var vue3Index = viewName.indexOf('*')
  if (vue3Index !== -1) {
    var prefixIndex =
      vue3Index > 0 && viewName.charAt(vue3Index - 1) === '/'
        ? vue3Index - 1
        : vue3Index
    return substitutePathSuffix(
      viewName,
      path,
      prefixIndex,
      viewName.length - prefixIndex
    )
  }

  return viewName
}

function substitutePathSuffix(viewName, path, patternIndex, patternLength) {
  var prefix = viewName.slice(0, patternIndex)
  var normalizedPath = normalizePath(path)
  var prefixSegmentCount = prefix
    ? prefix.split('/').length - 1
    : 0
  var suffix = normalizedPath
    .split('/')
    .slice(prefixSegmentCount + 1)
    .join('/')
  var trailing = viewName.slice(patternIndex + patternLength)
  return (
    prefix +
      (suffix ? '/' + suffix : '') +
      trailing
  ).replace(/\/+/g, '/') || '/'
}

function normalizePath(path) {
  var normalized = String(path || '/').split('#')[0].split('?')[0]
  return normalized.charAt(0) === '/' ? normalized : '/' + normalized
}

function copyConstructorProperties(source, target) {
  var propertyNames = Object.getOwnPropertyNames(source)
  for (var i = 0; i < propertyNames.length; i += 1) {
    var propertyName = propertyNames[i]
    if (
      propertyName === 'length' ||
      propertyName === 'name' ||
      propertyName === 'arguments' ||
      propertyName === 'caller' ||
      propertyName === 'prototype'
    ) {
      continue
    }
    try {
      Object.defineProperty(
        target,
        propertyName,
        Object.getOwnPropertyDescriptor(source, propertyName)
      )
    } catch (error) {
      target[propertyName] = source[propertyName]
    }
  }
}
