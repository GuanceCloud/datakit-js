import { JsBirdge, isAndroid, isIos, userAgent } from './mobileUtil'

describe('mobileUtil', () => {
  let originalBridge
  let originalMapWebViewCallBack

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2024-01-01T00:00:00.000Z'))
    originalBridge = window.FTWebViewJavascriptBridge
    originalMapWebViewCallBack = window.mapWebViewCallBack
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    window.FTWebViewJavascriptBridge = originalBridge
    window.mapWebViewCallBack = originalMapWebViewCallBack
  })

  it('should expose a lower-cased user agent snapshot', () => {
    expect(userAgent).toBe(navigator.userAgent.toLowerCase())
    expect(typeof isAndroid()).toBe('boolean')
    expect(typeof isIos()).toBe('boolean')
  })

  it('should send events through the non-iOS bridge and register callback tags', () => {
    const bridgeApi = {
      sendEvent: jasmine.createSpy('sendEvent')
    }
    window.FTWebViewJavascriptBridge = bridgeApi

    const bridge = new JsBirdge()
    const params = {
      name: 'page_view',
      payload: { id: 1 }
    }

    bridge.sendEvent(params, jasmine.createSpy('callback'))

    const tag = bridge.tagMaps.page_view
    expect(tag).toBe('Unique id:' + new Date('2024-01-01T00:00:00.000Z').getTime())
    expect(params._tag).toBe(tag)
    expect(window.mapWebViewCallBack[tag]).toEqual(jasmine.any(Function))
    expect(bridgeApi.sendEvent).toHaveBeenCalledWith(
      JSON.stringify(params),
      'mapWebViewCallBack'
    )
  })

  it('should register event listeners through the non-iOS bridge', () => {
    const bridgeApi = {
      addEventListener: jasmine.createSpy('addEventListener')
    }
    const callback = jasmine.createSpy('callback')
    window.FTWebViewJavascriptBridge = bridgeApi

    const bridge = new JsBirdge()
    const params = {
      name: 'view_change'
    }

    bridge.addEventListener(params, callback)

    const tag = bridge.tagMaps.view_change
    expect(params._tag).toBe(tag)
    expect(bridgeApi.addEventListener).toHaveBeenCalledWith(
      JSON.stringify(params),
      'mapWebViewCallBack'
    )

    window.mapWebViewCallBack[tag]({ value: 1 }, undefined)
    expect(callback).toHaveBeenCalledWith({ value: 1 }, undefined)
  })

  it('should report missing event names back to the caller', () => {
    window.FTWebViewJavascriptBridge = {
      sendEvent: jasmine.createSpy('sendEvent'),
      addEventListener: jasmine.createSpy('addEventListener')
    }
    const bridge = new JsBirdge()
    const sendCallback = jasmine.createSpy('sendCallback')
    const listenCallback = jasmine.createSpy('listenCallback')

    bridge.sendEvent({}, sendCallback)
    bridge.addEventListener({}, listenCallback)

    expect(sendCallback).toHaveBeenCalledWith({
      error: 'please input event name'
    })
    expect(listenCallback).toHaveBeenCalledWith({
      error: 'please input event name'
    })
  })

  it('should swallow bridge api failures without throwing', () => {
    window.FTWebViewJavascriptBridge = {
      sendEvent: jasmine.createSpy('sendEvent').and.throwError('send failed'),
      addEventListener: jasmine
        .createSpy('addEventListener')
        .and.throwError('listen failed')
    }
    const bridge = new JsBirdge()

    expect(() => {
      bridge.sendEvent({ name: 'page_view' }, jasmine.createSpy('callback'))
      bridge.addEventListener(
        { name: 'view_change' },
        jasmine.createSpy('callback')
      )
    }).not.toThrow()
  })
})
