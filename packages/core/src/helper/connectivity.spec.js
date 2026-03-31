import { getConnectivity } from './connectivity'

describe('connectivity', () => {
  let originalOnLine
  let originalConnection

  beforeEach(() => {
    originalOnLine = window.navigator.onLine
    originalConnection = window.navigator.connection
  })

  afterEach(() => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: originalOnLine
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: originalConnection
    })
  })

  it('should expose connected status and connection details', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: true
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: {
        type: 'wifi',
        effectiveType: '4g'
      }
    })

    expect(getConnectivity()).toEqual({
      status: 'connected',
      interfaces: ['wifi'],
      effective_type: '4g'
    })
  })

  it('should expose offline status without interfaces when connection type is missing', () => {
    Object.defineProperty(window.navigator, 'onLine', {
      configurable: true,
      value: false
    })
    Object.defineProperty(window.navigator, 'connection', {
      configurable: true,
      value: {
        effectiveType: '3g'
      }
    })

    expect(getConnectivity()).toEqual({
      status: 'not_connected',
      interfaces: undefined,
      effective_type: '3g'
    })
  })
})
