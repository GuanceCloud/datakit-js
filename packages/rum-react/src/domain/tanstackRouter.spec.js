import { reactPlugin } from '../index'
import { resetReactPlugin } from './pluginState'
import {
  computeTanStackRouterViewName,
  wrapCreateRouter
} from './tanstackRouter'

describe('TanStack Router integration', () => {
  beforeEach(() => {
    resetReactPlugin()
  })

  it('should track path-changing load events by route template', () => {
    const rum = {
      startView: jasmine.createSpy('startView')
    }
    let onLoad
    const router = {
      state: {
        matches: [
          {
            fullPath: '/users/$userId',
            params: { userId: '42' }
          }
        ]
      },
      subscribe: jasmine
        .createSpy('subscribe')
        .and.callFake(function (eventName, callback) {
          expect(eventName).toBe('onLoad')
          onLoad = callback
        })
    }
    const createRouter = wrapCreateRouter(function () {
      return router
    })

    createRouter({})
    reactPlugin({ router: true }).onInit({
      publicApi: rum,
      rum,
      initConfiguration: {}
    })
    onLoad({ pathChanged: false })
    onLoad({ pathChanged: true })

    expect(rum.startView).toHaveBeenCalledOnceWith({
      name: '/users/$userId',
      context: {
        framework: 'react',
        router: 'tanstack-router'
      }
    })
  })

  it('should substitute splats and normalize index routes', () => {
    expect(
      computeTanStackRouterViewName([
        {
          fullPath: '/files/$',
          params: { _splat: 'reports/2026.pdf' }
        }
      ])
    ).toBe('/files/reports/2026.pdf')
    expect(
      computeTanStackRouterViewName([
        {
          fullPath: '/settings/',
          params: {}
        }
      ])
    ).toBe('/settings')
  })
})
