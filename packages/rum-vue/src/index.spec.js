import { createMemoryHistory } from 'vue-router'
import {
  addVueError,
  installVueErrorHandler,
  vuePlugin
} from './index'
import { resetVuePlugin } from './domain/pluginState'
import {
  computeVueRouterViewName,
  wrapRouterConstructor
} from './domain/vueRouter'
import { createRouter } from './entries/vueRouterV4'

describe('rum vue plugin', () => {
  beforeEach(() => {
    resetVuePlugin()
  })

  it('should enable manual views and install the app error handler', () => {
    const rum = {
      addError: jasmine.createSpy('addError'),
      startView: jasmine.createSpy('startView')
    }
    const previousErrorHandler = jasmine.createSpy('previousErrorHandler')
    const app = { config: { errorHandler: previousErrorHandler } }
    const initConfiguration = {}
    const plugin = vuePlugin({ app, router: true })

    plugin.onInit({ publicApi: rum, rum, initConfiguration })

    expect(initConfiguration.trackViewsManually).toBeTrue()
    expect(app.config.errorHandler).toEqual(jasmine.any(Function))
    expect(app.config.errorHandler).not.toBe(previousErrorHandler)
    expect(plugin.getConfigurationTelemetry()).toEqual({ router: true })
  })

  it('should report app errors through the plugin lifecycle', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {}
    const app = { config: {} }
    const error = new Error('component failed')
    const plugin = vuePlugin({ app })

    plugin.onInit({ addError, publicApi: rum, rum, initConfiguration: {} })
    app.config.errorHandler(error, null, 'render')

    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error,
        context: {
          framework: 'vue',
          component_stack: 'render'
        }
      })
    )
  })

  it('should report a Vue component stack and retain a previous handler', () => {
    const rum = {
      addError: jasmine.createSpy('addError')
    }
    const previousErrorHandler = jasmine.createSpy('previousErrorHandler')
    const app = { config: { errorHandler: previousErrorHandler } }
    const error = new Error('render failed')
    const instance = {
      $: {
        type: { name: 'CheckoutForm' },
        parent: { type: { name: 'CheckoutPage' }, parent: null }
      }
    }

    const stop = installVueErrorHandler(app, rum)
    app.config.errorHandler(error, instance, 'render function')
    stop()

    expect(rum.addError).toHaveBeenCalledOnceWith(error, {
      framework: 'vue',
      component_stack:
        'render function\nat <CheckoutForm>\nat <CheckoutPage>'
    })
    expect(previousErrorHandler).toHaveBeenCalledOnceWith(
      error,
      instance,
      'render function'
    )
    expect(app.config.errorHandler).toBe(previousErrorHandler)
  })

  it('should retain manually reported errors before initialization', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {}
    const error = new Error('setup failed')

    addVueError(error, null, 'setup', { feature: 'checkout' })
    const plugin = vuePlugin()
    plugin.onInit({ addError, publicApi: rum, rum, initConfiguration: {} })

    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error,
        handlingStack: jasmine.any(String),
        context: {
          framework: 'vue',
          component_stack: 'setup',
          feature: 'checkout'
        },
        startClocks: jasmine.any(Object)
      })
    )
  })

  it('should normalize matched Vue Router paths and catch-all routes', () => {
    expect(
      computeVueRouterViewName(
        [{ path: '/users' }, { path: '/users/:id' }],
        '/users/42'
      )
    ).toBe('/users/:id')
    expect(
      computeVueRouterViewName(
        [{ path: '/org/:orgId/:pathMatch(.*)*' }],
        '/org/123/a/b'
      )
    ).toBe('/org/:orgId/a/b')
    expect(computeVueRouterViewName([{ path: '*' }], '/not/found')).toBe(
      '/not/found'
    )
  })

  it('should track a real Vue Router and ignore query-only navigation', async () => {
    const rum = {
      addError: jasmine.createSpy('addError'),
      startView: jasmine.createSpy('startView')
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/users/:id', component: {} }]
    })
    await router.push('/users/42?tab=profile')

    const initConfiguration = {}
    vuePlugin({ router: true }).onInit({
      publicApi: rum,
      rum,
      initConfiguration
    })
    await router.push('/users/42?tab=activity')
    await router.push('/users/43')

    expect(initConfiguration.trackViewsManually).toBeTrue()
    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.startView.calls.allArgs()).toEqual([
      [
        {
          name: '/users/:id',
          context: { framework: 'vue', router: 'vue-router' }
        }
      ],
      [
        {
          name: '/users/:id',
          context: { framework: 'vue', router: 'vue-router' }
        }
      ]
    ])
  })

  it('should preserve Vue Router 3 constructor statics and instrument instances', () => {
    const install = jasmine.createSpy('install')
    const afterEach = jasmine.createSpy('afterEach')
    function VueRouter() {
      this.currentRoute = {
        path: '/legacy',
        matched: [{ path: '/legacy' }]
      }
      this.afterEach = afterEach
    }
    VueRouter.install = install

    const InstrumentedVueRouter = wrapRouterConstructor(VueRouter)
    const router = new InstrumentedVueRouter()

    expect(InstrumentedVueRouter.install).toBe(install)
    expect(router instanceof VueRouter).toBeTrue()
    expect(afterEach).toHaveBeenCalled()
  })
})
