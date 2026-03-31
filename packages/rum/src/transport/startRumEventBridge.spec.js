import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startRumEventBridge } from './startRumEventBridge'

describe('startRumEventBridge', () => {
  let originalBridge

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should send processed rum rows through the native bridge', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    window.FTWebViewJavascriptBridge = {
      sendEvent
    }
    const lifeCycle = new LifeCycle()

    startRumEventBridge(lifeCycle)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: 'view',
      date: 123,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      view: {
        id: 'view-1',
        url: 'https://example.com/products/42?tab=1',
        referrer: 'https://example.com',
        host: 'example.com',
        path: '/products/42',
        name: 'Products',
        path_group: '/products/?',
        pathname: '/products/42',
        loading_type: 'initial_load'
      },
      service: 'web',
      source: 'browser',
      display: {
        viewport: { width: 100, height: 200 }
      },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      action: {},
      user: {},
      device: {}
    })

    expect(sendEvent).toHaveBeenCalledTimes(1)
    const payload = JSON.parse(sendEvent.calls.mostRecent().args[0])
    expect(payload.name).toBe('rum')
    expect(payload.data).toEqual(
      jasmine.objectContaining({
        measurement: 'view',
        time: 123
      })
    )
  })
})
