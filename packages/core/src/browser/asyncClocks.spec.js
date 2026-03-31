import {
  buildEndpoint,
  fetchAndApplyRemoteClocks,
  fetchRemoteClocks
} from './asyncClocks'
import { display } from '../helper/display'

describe('asyncClocks', () => {
  let OriginalXMLHttpRequest
  let originalPerformanceNow
  let originalPerformanceTiming

  class FakeXMLHttpRequest extends EventTarget {
    constructor() {
      super()
      this.status = 0
      this.responseText = ''
      this.open = jasmine.createSpy('open')
      this.send = jasmine.createSpy('send')
      FakeXMLHttpRequest.instances.push(this)
    }
  }

  FakeXMLHttpRequest.instances = []

  beforeEach(() => {
    OriginalXMLHttpRequest = window.XMLHttpRequest
    originalPerformanceNow = performance.now
    originalPerformanceTiming = performance.timing
    FakeXMLHttpRequest.instances = []
    window.XMLHttpRequest = FakeXMLHttpRequest
    Object.defineProperty(performance, 'timing', {
      configurable: true,
      value: originalPerformanceTiming
    })
  })

  afterEach(() => {
    window.XMLHttpRequest = OriginalXMLHttpRequest
    performance.now = originalPerformanceNow
    Object.defineProperty(performance, 'timing', {
      configurable: true,
      value: originalPerformanceTiming
    })
  })

  it('should build an endpoint from a relative datakit origin', () => {
    expect(
      buildEndpoint({
        datakitOrigin: '/proxy/',
        applicationId: 'app-id'
      })
    ).toBe(location.origin + '/proxy/v1/env_variable?app_id=app-id')
  })

  it('should append token and headless flag when site and client token are provided', () => {
    expect(
      buildEndpoint({
        site: 'https://testing-openway.dataflux.cn/',
        applicationId: 'app-id',
        clientToken: 'token-1'
      })
    ).toBe(
      'https://testing-openway.dataflux.cn/v1/env_variable?app_id=app-id&token=token-1&to_headless=true'
    )
  })

  it('should fetch remote clocks and forward the remote content on success', () => {
    const callback = jasmine.createSpy('callback')

    fetchRemoteClocks(
      {
        datakitUrl: 'https://example.com',
        applicationId: 'app-id'
      },
      callback
    )

    const xhr = FakeXMLHttpRequest.instances[0]
    expect(xhr.open).toHaveBeenCalledWith(
      'GET',
      'https://example.com/v1/env_variable?app_id=app-id'
    )
    expect(xhr.send).toHaveBeenCalled()

    xhr.status = 200
    xhr.responseText = JSON.stringify({ content: 1700000000000 })
    xhr.dispatchEvent(new Event('load'))

    expect(callback).toHaveBeenCalledWith(1700000000000)
  })

  it('should report an error and return an empty object on network failures', () => {
    const callback = jasmine.createSpy('callback')
    const displayErrorSpy = spyOn(display, 'error')

    fetchRemoteClocks(
      {
        datakitUrl: 'https://example.com',
        applicationId: 'app-id'
      },
      callback
    )

    const xhr = FakeXMLHttpRequest.instances[0]
    xhr.dispatchEvent(new Event('error'))

    expect(callback).toHaveBeenCalledWith({})
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'Error fetching the remote configuration.'
    )
  })

  it('should report an error when the response status is not 200', () => {
    const callback = jasmine.createSpy('callback')
    const displayErrorSpy = spyOn(display, 'error')

    fetchRemoteClocks(
      {
        datakitUrl: 'https://example.com',
        applicationId: 'app-id'
      },
      callback
    )

    const xhr = FakeXMLHttpRequest.instances[0]
    xhr.status = 500
    xhr.responseText = '{}'
    xhr.dispatchEvent(new Event('load'))

    expect(callback).not.toHaveBeenCalled()
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'Error fetching the remote configuration.'
    )
  })

  it('should apply the remote clock offset using navigation start and round-trip time', () => {
    const callback = jasmine.createSpy('callback')

    performance.now = jasmine
      .createSpy('performance.now')
      .and.returnValues(100, 160)
    Object.defineProperty(performance, 'timing', {
      configurable: true,
      value: { navigationStart: 1000 }
    })

    fetchAndApplyRemoteClocks(
      {
        datakitUrl: 'https://example.com',
        applicationId: 'app-id'
      },
      callback
    )

    const xhr = FakeXMLHttpRequest.instances[0]
    xhr.status = 200
    xhr.responseText = JSON.stringify({ content: 2000 })
    xhr.dispatchEvent(new Event('load'))

    expect(callback).toHaveBeenCalledWith(870)
  })
})
