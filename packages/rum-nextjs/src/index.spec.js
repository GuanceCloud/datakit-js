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

  it('should wait for an App Router transition to commit before starting a view', () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    nextjsPlugin().onInit({ publicApi: rum, rum, initConfiguration: {} })
    rum.startView.calls.reset()

    onRouterTransitionStart('/users/42?tab=profile')
    expect(rum.startView).not.toHaveBeenCalled()

    startNextjsView('/users/[id]')

    expect(rum.startView.calls.allArgs()).toEqual([
      [
        {
          name: '/users/[id]',
          url: window.location.origin + '/users/42?tab=profile',
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
    expect(
      computeViewNameFromParams('/users/users', { id: 'users' })
    ).toBe('/users/users')
    expect(
      computeViewNameFromParams('/a/b/a/b', { slug: ['a', 'b'] })
    ).toBe('/a/b/a/b')
  })

  it('should track only completed Pages Router transitions', () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    var routeChangeStart
    var routeChangeComplete
    var routeChangeError
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
          } else if (name === 'routeChangeError') {
            routeChangeError = callback
          }
        }),
        off: jasmine.createSpy('off')
      }
    }

    const stop = trackNextjsRouter(router, rum)
    routeChangeStart('/users/42?tab=activity')
    expect(rum.startView).toHaveBeenCalledTimes(1)
    routeChangeComplete('/users/42?tab=activity')

    routeChangeStart('/canceled')
    routeChangeError(new Error('canceled'), '/canceled')
    expect(rum.startView).toHaveBeenCalledTimes(1)

    router.asPath = '/users/43'
    routeChangeStart('/users/43')
    expect(rum.startView).toHaveBeenCalledTimes(1)
    routeChangeComplete('/users/43')
    stop()

    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.startView.calls.allArgs()[0][0].name).toBe('/users/[id]')
    expect(rum.startView.calls.allArgs()[1][0]).toEqual({
      name: '/users/[id]',
      url: window.location.origin + '/users/43',
      context: { framework: 'nextjs', router: 'next-router' }
    })
    expect(rum.setViewName).not.toHaveBeenCalled()
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeStart',
      routeChangeStart
    )
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeComplete',
      routeChangeComplete
    )
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeError',
      routeChangeError
    )
  })

  it('should allow a Pages Router view name callback to skip a transition', () => {
    const rum = {
      setViewName: jasmine.createSpy('setViewName'),
      startView: jasmine.createSpy('startView')
    }
    const callbacks = {}
    const router = {
      isReady: false,
      pathname: '/private',
      asPath: '/private',
      events: {
        on: function (name, callback) {
          callbacks[name] = callback
        },
        off: jasmine.createSpy('off')
      }
    }

    trackNextjsRouter(router, rum, {
      getViewName: function () {
        return undefined
      }
    })
    callbacks.routeChangeStart('/private')
    callbacks.routeChangeComplete('/private')

    expect(rum.startView).not.toHaveBeenCalled()
  })

  it('should start Pages Router views after the route commits', async () => {
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
    expect(rum.startView).toHaveBeenCalledTimes(1)

    router.pathname = '/about'
    router.asPath = '/about'
    await act(async function () {
      root.render(React.createElement(RumNextjsPagesRouter))
    })

    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.startView.calls.allArgs()[1][0]).toEqual({
      name: '/about',
      url: window.location.origin + '/about',
      context: { framework: 'nextjs', router: 'next-router' }
    })
    expect(rum.setViewName).not.toHaveBeenCalled()

    await act(async function () {
      root.unmount()
    })
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeStart',
      callbacks.routeChangeStart
    )
    expect(router.events.off).toHaveBeenCalledWith(
      'routeChangeError',
      callbacks.routeChangeError
    )
  })

  it('should start App Router views after React commits the route', async () => {
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
      name: '/users/[id]',
      url: window.location.origin + '/users/42',
      context: { framework: 'nextjs', router: 'next-router' }
    })
    expect(rum.setViewName).not.toHaveBeenCalled()
    expect(renderOrder.slice(0, 2)).toEqual(['content', 'start-view'])

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

    onRouterTransitionStart('/private')
    setNextNavigation('/login', {})
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
    expect(rum.startView.calls.allArgs()[2][0]).toEqual({
      name: '/login',
      url: window.location.origin + '/login',
      context: { framework: 'nextjs', router: 'next-router' }
    })

    await act(async function () {
      root.unmount()
    })
  })
})
