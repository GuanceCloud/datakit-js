import { createMemoryRouter } from 'react-router-dom'
import { createMemoryRouter as createMemoryRouterV7 } from 'react-router-7'
import { createMemoryRouter as createMemoryRouterV8 } from 'react-router'
import {
  addReactError,
  createErrorBoundary,
  reactPlugin
} from './index'
import { resetReactPlugin } from './domain/pluginState'
import {
  computeReactRouterViewName,
  wrapCreateRouter
} from './domain/reactRouter'

describe('rum react plugin', () => {
  beforeEach(() => {
    resetReactPlugin()
  })

  it('should enable manual views before RUM configuration is built', () => {
    const rum = {
      addError: jasmine.createSpy('addError'),
      startView: jasmine.createSpy('startView')
    }
    const initConfiguration = {}
    const plugin = reactPlugin({ router: true })

    plugin.onInit({ publicApi: rum, rum, initConfiguration })
    plugin.onRumStart({ addError: rum.addError, publicApi: rum, rum })

    expect(initConfiguration.trackViewsManually).toBeTrue()
    expect(plugin.getConfigurationTelemetry()).toEqual({ router: true })
  })

  it('should retain errors reported before plugin initialization', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    const error = new Error('render failed')
    error.df_context = { feature: 'checkout' }

    addReactError(error, { componentStack: '\n    at Checkout' }, { step: 2 })
    const plugin = reactPlugin()
    plugin.onInit({ addError, publicApi: rum, rum, initConfiguration: {} })

    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error,
        handlingStack: jasmine.any(String),
        context: {
          framework: 'react',
          component_stack: '\n    at Checkout',
          feature: 'checkout',
          step: 2
        },
        startClocks: jasmine.any(Object)
      })
    )
  })

  it('should create an error boundary that reports and delegates errors', () => {
    const reportError = jasmine.createSpy('reportError')
    const onError = jasmine.createSpy('onError')
    const ErrorBoundary = createErrorBoundary(reportError, 'CheckoutBoundary')
    const error = new Error('boom')
    const errorInfo = { componentStack: '\n    at Checkout' }
    const boundary = new ErrorBoundary({
      context: { route: '/checkout' },
      onError,
      fallback: function () {
        return null
      }
    })

    boundary.componentDidCatch(error, errorInfo)

    expect(ErrorBoundary.displayName).toBe('CheckoutBoundary')
    expect(reportError).toHaveBeenCalledOnceWith(error, errorInfo, {
      route: '/checkout'
    })
    expect(onError).toHaveBeenCalledOnceWith(error, errorInfo)
  })

  it('should compute nested route templates and preserve useful splats', () => {
    expect(
      computeReactRouterViewName([
        { route: { path: '/' }, params: {} },
        { route: { path: 'users' }, params: {} },
        { route: { path: ':id' }, params: { id: '42' } }
      ])
    ).toBe('/users/:id')
    expect(
      computeReactRouterViewName([
        { route: { path: '/files/*' }, params: { '*': 'a/b.txt' } }
      ])
    ).toBe('/files/a/b.txt')
    expect(computeReactRouterViewName([], '/fallback?tab=1')).toBe('/fallback')
  })

  it('should track a real React Router data router by route template', async () => {
    const rum = {
      addError: jasmine.createSpy('addError'),
      startView: jasmine.createSpy('startView')
    }
    const createRouter = wrapCreateRouter(createMemoryRouter)
    const router = createRouter(
      [
        {
          path: '/users/:id',
          element: null
        }
      ],
      { initialEntries: ['/users/42'] }
    )

    reactPlugin({ router: true }).onInit({
      publicApi: rum,
      rum,
      initConfiguration: {}
    })
    expect(rum.startView).toHaveBeenCalledOnceWith({
      name: '/users/:id',
      context: {
        framework: 'react',
        router: 'react-router'
      }
    })

    await router.navigate('/users/43')
    await router.navigate('/users/43?tab=profile')

    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.startView.calls.mostRecent().args[0].name).toBe('/users/:id')
    router.dispose()
  })

  it('should track a React Router v7 data router', async () => {
    await expectDataRouterViews(createMemoryRouterV7)
  })

  it('should track a React Router v8 data router', async () => {
    await expectDataRouterViews(createMemoryRouterV8)
  })

  it('should replay an initial loader error to the next router subscriber', () => {
    const state = {
      location: { pathname: '/' },
      matches: [{ route: { path: '/' }, params: {} }]
    }
    let subscriberCount = 0
    const router = {
      state,
      subscribe: function (callback) {
        subscriberCount += 1
        if (subscriberCount === 1) {
          callback(state, { newErrors: { root: new Error('loader failed') } })
        }
        return function () {}
      }
    }
    const createRouter = wrapCreateRouter(function () {
      return router
    })
    const instrumentedRouter = createRouter()
    const routerProviderSubscriber = jasmine.createSpy(
      'routerProviderSubscriber'
    )

    instrumentedRouter.subscribe(routerProviderSubscriber)

    expect(routerProviderSubscriber).toHaveBeenCalledOnceWith(
      state,
      jasmine.objectContaining({ newErrors: jasmine.any(Object) })
    )
  })
})

async function expectDataRouterViews(createMemoryRouterForVersion) {
  const rum = {
    startView: jasmine.createSpy('startView')
  }
  const createRouter = wrapCreateRouter(createMemoryRouterForVersion)
  const router = createRouter(
    [{ path: '/orders/:orderId', element: null }],
    { initialEntries: ['/orders/1'] }
  )

  reactPlugin({ router: true }).onInit({
    publicApi: rum,
    rum,
    initConfiguration: {}
  })
  await router.navigate('/orders/2')

  expect(rum.startView.calls.allArgs()).toEqual([
    [
      {
        name: '/orders/:orderId',
        context: {
          framework: 'react',
          router: 'react-router'
        }
      }
    ],
    [
      {
        name: '/orders/:orderId',
        context: {
          framework: 'react',
          router: 'react-router'
        }
      }
    ]
  ])
  router.dispose()
}
