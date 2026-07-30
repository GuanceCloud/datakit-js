import '@angular/compiler'
import { NavigationEnd } from '@angular/router'

import {
  addAngularError,
  angularPlugin,
  computeAngularViewName,
  createAngularErrorHandler,
  resetAngularPlugin,
  trackAngularRouter
} from './index'
import { provideRumErrorHandler, provideRumRouter } from './providers'

describe('rum angular plugin', () => {
  beforeEach(() => {
    resetAngularPlugin()
  })

  it('should enable manual views when router integration is enabled', () => {
    const rum = {
      addError: jasmine.createSpy('addError'),
      startView: jasmine.createSpy('startView')
    }
    const initConfiguration = {}
    const plugin = angularPlugin({ router: true })

    plugin.onInit({ publicApi: rum, rum, initConfiguration })

    expect(initConfiguration.trackViewsManually).toBeTrue()
    expect(plugin.getConfigurationTelemetry()).toEqual({ router: true })
  })

  it('should retain errors before initialization and unwrap Angular errors', () => {
    const addError = jasmine.createSpy('addError')
    const rum = {}
    const originalError = new Error('component failed')

    addAngularError(
      { ngOriginalError: { originalError: originalError } },
      { feature: 'checkout' }
    )
    const plugin = angularPlugin()
    plugin.onInit({ addError, publicApi: rum, rum, initConfiguration: {} })

    expect(addError).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        error: originalError,
        handlingStack: jasmine.any(String),
        context: {
          framework: 'angular',
          feature: 'checkout'
        },
        startClocks: jasmine.any(Object)
      })
    )
  })

  it('should preserve an existing Angular error handler', () => {
    const delegate = { handleError: jasmine.createSpy('handleError') }
    const handler = createAngularErrorHandler(delegate)
    const error = new Error('boom')

    handler.handleError(error)

    expect(delegate.handleError).toHaveBeenCalledOnceWith(error)
  })

  it('should compute primary route templates and wildcard values', () => {
    expect(
      computeAngularViewName({
        children: [
          {
            outlet: 'sidebar',
            routeConfig: { path: 'help' },
            children: []
          },
          {
            outlet: 'primary',
            routeConfig: { path: 'users' },
            children: [
              {
                outlet: 'primary',
                routeConfig: { path: ':id' },
                children: []
              }
            ]
          }
        ]
      })
    ).toBe('/users/:id')
    expect(
      computeAngularViewName({
        children: [
          {
            outlet: 'primary',
            routeConfig: { path: '**' },
            url: [{ path: 'missing' }, { path: 'page' }],
            children: []
          }
        ]
      })
    ).toBe('/missing/page')
  })

  it('should track completed navigation and ignore guards and query-only changes', () => {
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    var routerSubscriber
    const root = {
      children: [
        {
          outlet: 'primary',
          routeConfig: { path: 'orders' },
          children: [
            {
              outlet: 'primary',
              routeConfig: { path: ':id' },
              children: []
            }
          ]
        }
      ]
    }
    const router = {
      events: {
        subscribe: jasmine
          .createSpy('subscribe')
          .and.callFake(function (callback) {
            routerSubscriber = callback
            return { unsubscribe: jasmine.createSpy('unsubscribe') }
          })
      },
      routerState: {
        snapshot: { root }
      }
    }

    trackAngularRouter(router, rum)
    routerSubscriber(
      {
        id: 1,
        url: '/orders/42',
        urlAfterRedirects: '/orders/42',
        state: { root },
        shouldActivate: true
      }
    )
    routerSubscriber(
      new NavigationEnd(
        2,
        '/orders/42?tab=items',
        '/orders/42?tab=items'
      )
    )
    routerSubscriber(
      new NavigationEnd(
        3,
        '/orders/42?tab=summary',
        '/orders/42?tab=summary'
      )
    )

    expect(rum.startView).toHaveBeenCalledOnceWith({
      name: '/orders/:id',
      url: '/orders/42?tab=items',
      context: {
        framework: 'angular',
        router: 'angular-router'
      }
    })
  })

  it('should expose Angular environment providers', () => {
    expect(provideRumErrorHandler()).toEqual(
      jasmine.objectContaining({ ɵproviders: jasmine.any(Array) })
    )
    expect(provideRumRouter()).toEqual(
      jasmine.objectContaining({ ɵproviders: jasmine.any(Array) })
    )
  })
})
