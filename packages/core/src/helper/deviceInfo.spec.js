import { deviceInfo, getDeviceInfo } from './deviceInfo'

describe('deviceInfo', () => {
  let originalUserAgent
  let originalLanguage
  let originalBrowserLanguage
  let originalConnection
  let originalMimeTypes

  beforeEach(() => {
    originalUserAgent = window.navigator.userAgent
    originalLanguage = window.navigator.language
    originalBrowserLanguage = window.navigator.browserLanguage
    originalConnection = window.navigator.connection
    originalMimeTypes = window.navigator.mimeTypes
  })

  afterEach(() => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value: originalUserAgent
    })
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: originalLanguage
    })
    Object.defineProperty(window.navigator, 'browserLanguage', {
      configurable: true,
      value: originalBrowserLanguage
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: originalConnection
    })
    Object.defineProperty(window.navigator, 'mimeTypes', {
      configurable: true,
      value: originalMimeTypes
    })
  })

  it('should expose a backward-compatible deviceInfo object', () => {
    expect(deviceInfo).toEqual(jasmine.any(Object))
  })

  it('should compute browser major version and network type at call time', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    })
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'en-us'
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: { effectiveType: '4g' }
    })

    const info = getDeviceInfo()

    expect(info.browser).toBe('Chrome')
    expect(info.browserVersion).toBe('120.0.0.0')
    expect(info.browserVersionMajor).toBe('120')
    expect(info.networkType).toBe('wifi')
    expect(info.userAgent).toContain('Chrome/120.0.0.0')
  })

  it('should recognize HarmonyOS without changing the export shape', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Linux; HarmonyOS 4.0; HUAWEI) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36'
    })
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: 'zh-cn'
    })

    const info = getDeviceInfo()

    expect(info.os).toBe('HarmonyOS')
    expect(info.osVersion).toBe('4.0')
    expect(info.osVersionMajor).toBe('4')
    expect(info.browser).toBe('Chrome')
    expect(typeof deviceInfo).toBe('object')
  })

  it('should detect EdgeHTML for legacy Edge and Blink for Chromium Edge', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/42.0.2311.135 Safari/537.36 Edge/18.19041'
    })

    const legacyEdge = getDeviceInfo()

    expect(legacyEdge.browser).toBe('Edge')
    expect(legacyEdge.browserVersion).toBe('18.19041')
    expect(legacyEdge.browserVersionMajor).toBe('18')
    expect(legacyEdge.os).toBe('Windows')
    expect(legacyEdge.engine).toBeUndefined()

    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36 Edg/120.0.2210.91'
    })

    const chromiumEdge = getDeviceInfo()

    expect(chromiumEdge.browser).toBe('Edge')
    expect(chromiumEdge.browserVersion).toBe('120.0.2210.91')
    expect(chromiumEdge.browserVersionMajor).toBe('120')
  })

  it('should detect Opera as Blink and classify iPad as iPad instead of Mobile', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (iPad; CPU OS 16_0 like Mac OS X) AppleWebKit/605.1.15 Version/16.0 OPR/95.0.0.0 Mobile/15E148 Safari/604.1'
    })

    const info = getDeviceInfo()

    expect(info.browser).toBe('Opera')
    expect(info.browserVersion).toBe('95.0.0.0')
    expect(info.browserVersionMajor).toBe('95')
    expect(info.device).toBe('iPad')
    expect(info.os).toBe('iOS')
    expect(info.osVersion).toBe('16.0')
  })

  it('should use browserLanguage fallback and keep working when mimeTypes is missing', () => {
    Object.defineProperty(window.navigator, 'userAgent', {
      configurable: true,
      value:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36'
    })
    Object.defineProperty(window.navigator, 'language', {
      configurable: true,
      value: ''
    })
    Object.defineProperty(window.navigator, 'browserLanguage', {
      configurable: true,
      value: 'fr-fr'
    })
    Object.defineProperty(window.navigator, 'mimeTypes', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: { type: 'cellular' }
    })

    const info = getDeviceInfo()

    expect(info.browser).toBe('Chrome')
    expect(info.networkType).toBe('cellular')
    expect(info.userAgent).toContain('Macintosh')
    expect(getDeviceInfo()).toEqual(jasmine.any(Object))
  })
})
