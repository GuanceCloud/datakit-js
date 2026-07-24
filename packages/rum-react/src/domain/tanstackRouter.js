import { onRumInit } from './pluginState'

export function wrapCreateRouter(createRouter) {
  if (typeof createRouter !== 'function') {
    throw new Error('A TanStack Router create function is required')
  }

  return function () {
    var router = createRouter.apply(this, arguments)
    if (!router || typeof router.subscribe !== 'function') {
      throw new Error('A TanStack Router instance is required')
    }

    router.subscribe('onLoad', function (event) {
      if (!event.pathChanged) {
        return
      }
      startTanStackRouterView(router.state.matches)
    })
    return router
  }
}

export function startTanStackRouterView(matches) {
  onRumInit(function (configuration, rum) {
    if (!configuration.router) {
      return
    }

    rum.startView({
      name: computeTanStackRouterViewName(matches),
      context: {
        framework: 'react',
        router: 'tanstack-router'
      }
    })
  })
}

export function computeTanStackRouterViewName(matches) {
  if (!matches || matches.length === 0) {
    return ''
  }

  var lastMatch = matches[matches.length - 1]
  var viewName = substitutePathSplat(
    lastMatch.fullPath,
    lastMatch.params || {}
  )
  if (viewName.length > 1 && viewName.charAt(viewName.length - 1) === '/') {
    viewName = viewName.slice(0, -1)
  }
  return viewName || '/'
}

function substitutePathSplat(path, params) {
  if (
    typeof path !== 'string' ||
    path.slice(-2) !== '/$' ||
    params._splat === undefined
  ) {
    return path || ''
  }
  return path.slice(0, -1) + params._splat
}
