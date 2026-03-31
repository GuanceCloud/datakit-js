import {
  BridgeCapability,
  bridgeSupports,
  canUseEventBridge,
  getEventBridge
} from './eventBridge'

describe('eventBridge', () => {
  let originalBridge

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should expose bridge helpers when the native bridge is available', () => {
    const sendEvent = jasmine.createSpy('sendEvent')
    window.FTWebViewJavascriptBridge = {
      getCapabilities: () => '["records"]',
      getPrivacyLevel: () => 'mask-user-input',
      getAllowedWebViewHosts: () => '["example.com"]',
      sendEvent
    }

    const bridge = getEventBridge()
    bridge.send('view', { id: 1 }, 'view-id')

    expect(bridge.getCapabilities()).toEqual(['records'])
    expect(bridge.getPrivacyLevel()).toBe('mask-user-input')
    expect(bridge.getAllowedWebViewHosts()).toEqual(['example.com'])
    expect(sendEvent).toHaveBeenCalledWith(
      JSON.stringify({
        name: 'view',
        data: { id: 1 },
        view: { id: 'view-id' }
      })
    )
  })

  it('should support capability and host checks', () => {
    window.FTWebViewJavascriptBridge = {
      getCapabilities: () => '["records"]',
      getAllowedWebViewHosts: () => '["example.com"]'
    }

    expect(bridgeSupports(BridgeCapability.RECORDS)).toBeTrue()
    expect(canUseEventBridge('example.com')).toBeTrue()
    expect(canUseEventBridge('sub.example.com')).toBeTrue()
    expect(canUseEventBridge('other.com')).toBeFalse()
  })

  it('should allow the bridge when allowed hosts are not exposed', () => {
    window.FTWebViewJavascriptBridge = {}
    expect(canUseEventBridge('example.com')).toBeTrue()

    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => null
    }
    expect(canUseEventBridge('example.com')).toBeTrue()
  })

  it('should return undefined when the bridge is unavailable', () => {
    window.FTWebViewJavascriptBridge = undefined

    expect(getEventBridge()).toBeUndefined()
    expect(bridgeSupports(BridgeCapability.RECORDS)).toBeFalse()
  })
})
