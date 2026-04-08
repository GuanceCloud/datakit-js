import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startLogsBridge } from './startLogsBridge'

describe('logs/startLogsBridge', () => {
  let originalBridge

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should forward collected logs to the event bridge', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    const lifeCycle = new LifeCycle()

    window.FTWebViewJavascriptBridge = {
      sendEvent
    }

    startLogsBridge(lifeCycle)
    lifeCycle.notify(LifeCycleEventType.LOG_COLLECTED, {
      message: 'hello',
      status: 'info'
    })

    expect(sendEvent).toHaveBeenCalledWith(
      JSON.stringify({
        name: 'log',
        data: {
          message: 'hello',
          status: 'info'
        }
      })
    )
  })
})
