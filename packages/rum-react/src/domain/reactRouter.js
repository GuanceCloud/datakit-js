import React from 'react'
import { onRumInit } from './pluginState'

export function wrapCreateRouter(createRouter) {
  if (typeof createRouter !== 'function') {
    throw new Error('A React Router create function is required')
  }

  return function () {
    var router = createRouter.apply(this, arguments)
    instrumentDataRouter(router)
    return router
  }
}

export function wrapUseRoutes(dependencies) {
  return function (routes, locationArgument) {
    var location = dependencies.useLocation()
    var pathname =
      typeof locationArgument === 'string'
        ? locationArgument
        : (locationArgument && locationArgument.pathname) || location.pathname
    var pathnameRef = React.useRef(null)
    var matches = dependencies.matchRoutes(routes, pathname)
    var renderedRoutes = dependencies.useRoutes(routes, locationArgument)
    var useCommitEffect =
      typeof window === 'undefined' ? React.useEffect : React.useLayoutEffect

    useCommitEffect(
      function () {
        if (pathnameRef.current === pathname || !matches) {
          return
        }
        pathnameRef.current = pathname
        startReactRouterView({
          location: { pathname: pathname },
          matches: matches
        })
      },
      [pathname, matches]
    )

    return renderedRoutes
  }
}

export function createRoutesComponent(useRoutes, createRoutesFromChildren) {
  return function Routes(props) {
    return useRoutes(
      createRoutesFromChildren(props.children),
      props.location
    )
  }
}

export function startReactRouterView(state) {
  onRumInit(function (configuration, rum) {
    if (!configuration.router) {
      return
    }

    var location = getRouterLocation(state)
    var matches = state && state.matches
    var pathname = getPathname(location)
    var viewName =
      typeof configuration.getViewName === 'function'
        ? configuration.getViewName(location, matches)
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
  })
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

function instrumentDataRouter(router) {
  if (
    !router ||
    !router.state ||
    typeof router.subscribe !== 'function'
  ) {
    throw new Error('A React Router data router is required')
  }

  var lastPathname
  var pendingInitialError
  var hasNextSubscriberAttached = false
  var originalSubscribe = router.subscribe.bind(router)

  originalSubscribe(function (state, subscriberOptions) {
    if (
      subscriberOptions &&
      subscriberOptions.newErrors &&
      !hasNextSubscriberAttached
    ) {
      pendingInitialError = {
        state: state,
        options: subscriberOptions
      }
    }

    var pathname = getPathname(getRouterLocation(state))
    if (pathname === undefined || pathname === lastPathname) {
      return
    }
    lastPathname = pathname
    startReactRouterView(state)
  })

  router.subscribe = function (callback) {
    hasNextSubscriberAttached = true
    router.subscribe = originalSubscribe
    var unsubscribe = originalSubscribe(callback)
    if (pendingInitialError) {
      callback(pendingInitialError.state, pendingInitialError.options)
      pendingInitialError = undefined
    }
    return unsubscribe
  }

  var initialPathname = getPathname(getRouterLocation(router.state))
  if (initialPathname !== undefined && initialPathname !== lastPathname) {
    lastPathname = initialPathname
    startReactRouterView(router.state)
  }
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
