import { createMemoryHistory, createRouter } from 'vue-router'
import {
  addNuxtError,
  computeNuxtViewName,
  normalizeNuxtRoutePath,
  nuxtRumPlugin,
  resetNuxtPlugin,
  setupNuxtErrorHandling,
  startTrackingNuxtViews
} from './index'

describe('rum nuxt plugin', () => {
  beforeEach(() => {
    resetNuxtPlugin()
  })

  it('should require a router and enable manual views', async () => {
    expect(function () {
      nuxtRumPlugin()
    }).toThrowError('nuxtRumPlugin requires a Vue Router instance')

    const rum = {
      startView: jasmine.createSpy('startView')
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: {} }]
    })
    await router.push('/')
    const initConfiguration = {}
    const plugin = nuxtRumPlugin({ router })

    plugin.onInit({ publicApi: rum, rum, initConfiguration })

    expect(initConfiguration.trackViewsManually).toBeTrue()
    expect(rum.startView).toHaveBeenCalledOnceWith({
      name: '/',
      context: { framework: 'nuxt', router: 'vue-router' }
    })
    expect(plugin.getConfigurationTelemetry()).toEqual({
      router: true,
      nuxt: true,
      error_handler: false
    })
  })

  it('should retain manually reported errors before initialization', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [{ path: '/', component: {} }]
    })
    const error = new Error('startup failed')

    addNuxtError({ error }, { feature: 'checkout' })
    const plugin = nuxtRumPlugin({ router })
    plugin.onInit({
      addError,
      publicApi: rum,
      rum,
      initConfiguration: {}
    })
    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error,
        handlingStack: jasmine.any(String),
        context: {
          framework: 'nuxt',
          component_stack: undefined,
          feature: 'checkout'
        },
        startClocks: jasmine.any(Object)
      })
    )
  })

  it('should deduplicate Vue and app:error reports and preserve custom handling', () => {
    const reportError = jasmine.createSpy('reportError')
    const previousErrorHandler = jasmine.createSpy('previousErrorHandler')
    const hooks = {}
    const nuxtApp = {
      vueApp: { config: { errorHandler: previousErrorHandler } },
      hook: jasmine.createSpy('hook').and.callFake(function (name, callback) {
        hooks[name] = callback
      })
    }
    const error = new Error('render failed')
    const instance = {
      $: { type: { name: 'CheckoutPage' }, parent: null }
    }

    setupNuxtErrorHandling(nuxtApp, reportError)
    nuxtApp.vueApp.config.errorHandler(error, instance, 'render')
    hooks['app:error'](error)
    hooks['app:suspense:resolve']()
    nuxtApp.vueApp.config.errorHandler(
      new Error('second failure'),
      null,
      'event handler'
    )

    expect(reportError).toHaveBeenCalledTimes(2)
    expect(reportError.calls.first().args).toEqual([
      error,
      instance,
      'render'
    ])
    expect(previousErrorHandler).toHaveBeenCalledTimes(2)
  })

  it('should stop calling the Nuxt default handler after suspense resolves', () => {
    const reportError = jasmine.createSpy('reportError')
    const defaultHandler = jasmine.createSpy('defaultHandler')
    defaultHandler.__nuxt_default = true
    const hooks = {}
    const nuxtApp = {
      vueApp: { config: { errorHandler: defaultHandler } },
      hook: function (name, callback) {
        hooks[name] = callback
      }
    }

    setupNuxtErrorHandling(nuxtApp, reportError)
    hooks['app:suspense:resolve']()
    nuxtApp.vueApp.config.errorHandler(new Error('late'), null, 'event')

    expect(reportError).toHaveBeenCalledTimes(1)
    expect(defaultHandler).not.toHaveBeenCalled()
  })

  it('should track real Nuxt-style routes, hashes, and failed navigation', async () => {
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/users/:id()', component: {} },
        { path: '/protected', component: {} }
      ]
    })
    router.beforeEach(function (to) {
      if (to.path === '/protected') {
        return false
      }
    })

    await router.push('/users/42?tab=profile')
    startTrackingNuxtViews(rum, router)
    await router.push('/users/42?tab=activity')
    await router.push('/users/42#details')
    await router.push('/protected')

    expect(rum.startView).toHaveBeenCalledTimes(2)
    expect(rum.startView.calls.allArgs()).toEqual([
      [
        {
          name: '/users/[id]',
          context: { framework: 'nuxt', router: 'vue-router' }
        }
      ],
      [
        {
          name: '/users/[id]',
          context: { framework: 'nuxt', router: 'vue-router' }
        }
      ]
    ])
  })

  it('should normalize Nuxt dynamic, optional, catch-all, and escaped paths', () => {
    expect(
      computeNuxtViewName([
        { path: '/layout' },
        { path: '/users-:group()/:id()' }
      ])
    ).toBe('/users-[group]/[id]')
    expect(normalizeNuxtRoutePath('/blog/:slug?')).toBe('/blog/[[slug]]')
    expect(normalizeNuxtRoutePath('/guides/:slug(.*)*')).toBe(
      '/guides/[...slug]'
    )
    expect(normalizeNuxtRoutePath('/docs/:slug([^/]*)*/edit')).toBe(
      '/docs/[...slug]/edit'
    )
  })
})
