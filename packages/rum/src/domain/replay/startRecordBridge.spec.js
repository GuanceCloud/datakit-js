import { startRecordBridge } from './startRecordBridge'

describe('startRecordBridge', () => {
  let originalBridge

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should send session replay records with the current view id', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    window.FTWebViewJavascriptBridge = {
      sendEvent
    }
    const bridge = startRecordBridge({
      findView: () => ({ id: 'view-current' })
    })

    bridge.addRecord({ type: 3, timestamp: 123 })

    expect(sendEvent).toHaveBeenCalledWith(
      JSON.stringify({
        name: 'session_replay',
        data: { type: 3, timestamp: 123 },
        view: { id: 'view-current' }
      })
    )
  })
})
