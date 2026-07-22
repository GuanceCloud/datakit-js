import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import {
  resetNextNavigation,
  setNextNavigation
} from 'next/navigation'
import { resetNextRouter, setNextRouter } from 'next/router'
import {
  ErrorBoundary,
  RumNextjsAppRouter,
  RumNextjsPagesRouter,
  addNextjsError,
  computeViewNameFromParams,
  nextjsPlugin,
  onRouterTransitionStart,
  resetNextjsPlugin,
  startNextjsView,
  trackNextjsRouter
} from './index'

describe('rum nextjs plugin', () => {
  var previousReactActEnvironment

  beforeEach(() => {
    previousReactActEnvironment = globalThis.IS_REACT_ACT_ENVIRONMENT
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
    resetNextjsPlugin()
    resetNextNavigation()
    resetNextRouter()
  })

  afterEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment
  })

  it('should always enable manual view tracking', () => {
    const rum = {
      addError: jasmine.createSpy('addError'),
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    const initConfiguration = {}
    const plugin = nextjsPlugin()

    plugin.onInit({ publicApi: rum, rum, initConfiguration })

    expect(initConfiguration.trackViewsManually).toBeTrue()
    expect(plugin.getConfigurationTelemetry()).toEqual({
      app_router: true,
      pages_router: false
    })
  })

  it('should start App Router transitions before rendering the route', () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    nextjsPlugin().onInit({ publicApi: rum, rum, initConfiguration: {} })
    rum.startView.calls.reset()

    onRouterTransitionStart('/users/42?tab=profile')
    startNextjsView('/about')

    expect(rum.startView.calls.allArgs()).toEqual([
      [
        {
          name: undefined,
          url: window.location.origin + '/users/42?tab=profile',
          context: { framework: 'nextjs', router: 'next-router' }
        }
      ],
      [
        {
          name: '/about',
          url: undefined,
          context: { framework: 'nextjs', router: 'next-router' }
        }
      ]
    ])
  })

  it('should retain Next.js errors before initialization', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    const error = new Error('server component failed')
    error.digest = 'digest-42'

    addNextjsError(error, { componentStack: '\n    at Page' }, { route: '/shop' })
    const plugin = nextjsPlugin()
    plugin.onInit({ addError, publicApi: rum, rum, initConfiguration: {} })

    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error,
        handlingStack: jasmine.any(String),
        context: {
          framework: 'nextjs',
          component_stack: '\n    at Page',
          digest: 'digest-42',
          route: '/shop'
        },
        startClocks: jasmine.any(Object)
      })
    )
  })

  it('should report errors through the Next.js error boundary', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    const plugin = nextjsPlugin()
    plugin.onInit({ addError, publicApi: rum, rum, initConfiguration: {} })
    const boundary = new ErrorBoundary({ fallback: null })
    const error = new Error('render failed')

    boundary.componentDidCatch(error, { componentStack: '\n    at Page' })

    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error,
        context: {
          framework: 'nextjs',
          component_stack: '\n    at Page'
        }
      })
    )
  })

  it('should compute App Router names from regular and catch-all params', () => {
    expect(
      computeViewNameFromParams('/users/42/posts/7', {
        userId: '42',
        postId: '7'
      })
    ).toBe('/users/[userId]/posts/[postId]')
    expect(
      computeViewNameFromParams('/docs/a/b/c', { slug: ['a', 'b', 'c'] })
    ).toBe('/docs/[...slug]')
    expect(
      computeViewNameFromParams('/x/a/b', {
        id: 'a',
        slug: ['a', 'b']
      })
    ).toBe('/x/[...slug]')
  })

  it('should track Pages Router completions and ignore query-only changes', () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    var routeChangeStart
    var routeChangeComplete
    const router = {
      isReady: true,
      pathname: '/users/[id]',
      asPath: '/users/42?tab=profile',
      events: {
        on: jasmine.createSpy('on').and.callFake(function (name, callback) {
          if (name === 'routeChangeStart') {
            routeChangeStart = callback
          } else if (name === 'routeChangeComplete') {
            routeChangeComplete = callback
          }
        }),
        off: jasmine.createSpy('off')
      }
    }

    const stop = trackNextjsRouter(router, rum)
    routeChangeStart('/users/42?tab=activity')
    routeChangeComplete('/users/42?tab=activity')
    router.asPath = '/users/43'
    routeChangeStart('/users/43')
    routeChangeComplete('/users/43')
    stop()

    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.startView.calls.allArgs()[0][0].name).toBe('/users/[id]')
    expect(rum.startView.calls.allArgs()[1][0]).toEqual({
      name: undefined,
      url: window.location.origin + '/users/43',
      context: { framework: 'nextjs', router: 'next-router' }
    })
    expect(rum.setViewName).toHaveBeenCalledOnceWith('/users/[id]')
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeStart',
      routeChangeStart
    )
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeComplete',
      routeChangeComplete
    )
  })

  it('should start Pages Router views before the route renders', async () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    const callbacks = {}
    const router = {
      isReady: true,
      pathname: '/users/[id]',
      asPath: '/users/42',
      events: {
        on: jasmine.createSpy('on').and.callFake(function (name, callback) {
          callbacks[name] = callback
        }),
        off: jasmine.createSpy('off')
      }
    }
    const container = document.createElement('div')
    const root = createRoot(container)

    nextjsPlugin().onInit({ publicApi: rum, rum, initConfiguration: {} })
    rum.startView.calls.reset()
    setNextRouter(router)

    await act(async function () {
      root.render(React.createElement(RumNextjsPagesRouter))
    })
    expect(rum.startView).toHaveBeenCalledTimes(1)

    callbacks.routeChangeStart('/about')
    expect(rum.startView.calls.allArgs()[1][0]).toEqual({
      name: undefined,
      url: window.location.origin + '/about',
      context: { framework: 'nextjs', router: 'next-router' }
    })

    router.pathname = '/about'
    router.asPath = '/about'
    await act(async function () {
      root.render(React.createElement(RumNextjsPagesRouter))
    })

    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.setViewName).toHaveBeenCalledOnceWith('/about')

    await act(async function () {
      root.unmount()
    })
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeStart',
      callbacks.routeChangeStart
    )
  })

  it('should start App Router views before following components render', async () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    const container = document.createElement('div')
    const root = createRoot(container)
    const renderOrder = []

    function Content() {
      renderOrder.push('content')
      return React.createElement('span', null, 'content')
    }

    rum.startView.and.callFake(function () {
      renderOrder.push('start-view')
    })
    nextjsPlugin().onInit({ publicApi: rum, rum, initConfiguration: {} })
    rum.startView.calls.reset()
    renderOrder.length = 0
    onRouterTransitionStart('/users/42')
    setNextNavigation('/users/42', { id: '42' })

    await act(async function () {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(RumNextjsAppRouter),
          React.createElement(Content)
        )
      )
    })

    expect(rum.startView).toHaveBeenCalledOnceWith({
      name: undefined,
      url: window.location.origin + '/users/42',
      context: { framework: 'nextjs', router: 'next-router' }
    })
    expect(rum.setViewName).toHaveBeenCalledOnceWith('/users/[id]')
    expect(renderOrder.slice(0, 2)).toEqual(['start-view', 'content'])

    onRouterTransitionStart('/users/42?tab=activity')
    setNextNavigation('/users/42', { id: '42' })
    await act(async function () {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(RumNextjsAppRouter),
          React.createElement(Content)
        )
      )
    })
    expect(rum.startView).toHaveBeenCalledTimes(1)

    onRouterTransitionStart('/about')
    setNextNavigation('/about', {})
    await act(async function () {
      root.render(
        React.createElement(
          React.Fragment,
          null,
          React.createElement(RumNextjsAppRouter),
          React.createElement(Content)
        )
      )
    })
    expect(rum.startView).toHaveBeenCalledTimes(2)

    await act(async function () {
      root.unmount()
    })
  })
})
