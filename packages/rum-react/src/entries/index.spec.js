import React, { act } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route } from 'react-router-dom'
import { reactPlugin } from '../index'
import { resetReactPlugin } from '../domain/pluginState'
import { wrapUseRoutes } from '../domain/reactRouter'
import * as reactRouterV6 from './reactRouterV6'
import * as reactRouterV7 from './reactRouterV7'
import * as reactRouterV8 from './reactRouterV8'
import * as tanstackRouter from './tanstackRouter'

describe('React router entries', () => {
  beforeEach(() => {
    resetReactPlugin()
    window.IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(() => {
    delete window.IS_REACT_ACT_ENVIRONMENT
  })

  it('should expose version-specific router creation APIs', () => {
    expect(reactRouterV6.createBrowserRouter).toEqual(jasmine.any(Function))
    expect(reactRouterV6.useRoutes).toEqual(jasmine.any(Function))
    expect(reactRouterV6.Routes).toEqual(jasmine.any(Function))
    expect(reactRouterV7.createBrowserRouter).toEqual(jasmine.any(Function))
    expect(reactRouterV8.createBrowserRouter).toBe(
      reactRouterV7.createBrowserRouter
    )
    expect(tanstackRouter.createRouter).toEqual(jasmine.any(Function))
  })

  it('should track declarative React Router v6 routes', async () => {
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    reactPlugin({ router: true }).onInit({
      publicApi: rum,
      rum,
      initConfiguration: {}
    })

    const container = document.createElement('div')
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async function () {
      root.render(
        React.createElement(
          MemoryRouter,
          {
            initialEntries: ['/products/42'],
            future: {
              v7_relativeSplatPath: true,
              v7_startTransition: true
            }
          },
          React.createElement(
            reactRouterV6.Routes,
            null,
            React.createElement(Route, {
              path: '/products/:productId',
              element: React.createElement('div')
            })
          )
        )
      )
    })

    expect(rum.startView).toHaveBeenCalledOnceWith({
      name: '/products/:productId',
      context: {
        framework: 'react',
        router: 'react-router'
      }
    })
    await act(async function () {
      root.unmount()
    })
    container.remove()
  })

  it('should not track a declarative route from a suspended render', async () => {
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    reactPlugin({ router: true }).onInit({
      publicApi: rum,
      rum,
      initConfiguration: {}
    })

    const useRoutes = wrapUseRoutes({
      useLocation: function () {
        return { pathname: '/not-committed' }
      },
      matchRoutes: function () {
        return [{ route: { path: '/not-committed' } }]
      },
      useRoutes: function () {
        return null
      }
    })
    const neverResolves = new Promise(function () {})

    function SuspendedRoutes() {
      useRoutes([])
      throw neverResolves
    }

    const container = document.createElement('div')
    const root = createRoot(container)
    await act(async function () {
      root.render(
        React.createElement(
          React.Suspense,
          { fallback: React.createElement('div', null, 'loading') },
          React.createElement(SuspendedRoutes)
        )
      )
    })

    expect(rum.startView).not.toHaveBeenCalled()

    await act(async function () {
      root.unmount()
    })
  })
})
