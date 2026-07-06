import { createHttpRequest, fetchStrategyWithFallback } from './httpRequest'

describe('httpRequest', () => {
  let OriginalXMLHttpRequest
  let originalFetch
  let originalRequest
  let originalSendBeacon

  class FakeXMLHttpRequest extends EventTarget {
    constructor() {
      super()
      this.status = 0
      this.headers = {}
      this.open = jasmine.createSpy('open')
      this.send = jasmine.createSpy('send')
      this.setRequestHeader = jasmine
        .createSpy('setRequestHeader')
        .and.callFake((name, value) => {
          this.headers[name] = value
        })
      FakeXMLHttpRequest.instances.push(this)
    }
  }

  FakeXMLHttpRequest.instances = []

  beforeEach(() => {
    OriginalXMLHttpRequest = window.XMLHttpRequest
    originalFetch = window.fetch
    originalRequest = window.Request
    originalSendBeacon = navigator.sendBeacon
    FakeXMLHttpRequest.instances = []
    window.XMLHttpRequest = FakeXMLHttpRequest
  })

  afterEach(() => {
    window.XMLHttpRequest = OriginalXMLHttpRequest
    window.fetch = originalFetch
    window.Request = originalRequest
    navigator.sendBeacon = originalSendBeacon
  })

  it('should use fetch without keepalive for regular requests', async () => {
    const onResponse = jasmine.createSpy('onResponse')
    window.fetch = jasmine
      .createSpy('fetch')
      .and.returnValue(Promise.resolve({ status: 202, type: 'basic' }))

    fetchStrategyWithFallback(
      'https://example.com/rum',
      {
        data: 'payload',
        bytesCount: 10,
        type: 'text/plain',
        encoding: 'gzip'
      },
      onResponse
    )

    await Promise.resolve()

    expect(window.fetch).toHaveBeenCalledWith(
      'https://example.com/rum?precision=ms&encoding=gzip',
      jasmine.objectContaining({
        method: 'POST',
        body: 'payload',
        mode: 'cors',
        headers: jasmine.objectContaining({
          'Content-Type': 'text/plain',
          'x-client-timestamp': jasmine.any(String)
        })
      })
    )
    expect(window.fetch.calls.mostRecent().args[1].keepalive).toBeUndefined()
    expect(onResponse).toHaveBeenCalledWith({ status: 202, type: 'basic' })
  })

  it('should use fetch without keepalive for FormData payloads', async () => {
    const onResponse = jasmine.createSpy('onResponse')
    const formData = new FormData()
    formData.append('segment', new Blob(['payload']), 'segment')
    window.fetch = jasmine
      .createSpy('fetch')
      .and.returnValue(Promise.resolve({ status: 202, type: 'basic' }))

    fetchStrategyWithFallback(
      'https://example.com/rum',
      {
        data: formData,
        bytesCount: 10
      },
      onResponse
    )

    await Promise.resolve()

    expect(window.fetch).toHaveBeenCalledWith(
      'https://example.com/rum?precision=ms',
      jasmine.objectContaining({
        method: 'POST',
        body: formData,
        mode: 'cors',
        headers: jasmine.objectContaining({
          'x-client-timestamp': jasmine.any(String)
        })
      })
    )
    expect(window.fetch.calls.mostRecent().args[1].keepalive).toBeUndefined()
    expect(onResponse).toHaveBeenCalledWith({ status: 202, type: 'basic' })
  })

  it('should fallback to xhr when fetch is unavailable', () => {
    const onResponse = jasmine.createSpy('onResponse')
    window.fetch = undefined

    fetchStrategyWithFallback(
      'https://example.com/rum?token=1',
      {
        data: 'payload',
        bytesCount: 10,
        type: 'text/plain'
      },
      onResponse
    )

    const request = FakeXMLHttpRequest.instances[0]
    expect(request.open).toHaveBeenCalledWith(
      'POST',
      'https://example.com/rum?token=1&precision=ms',
      true
    )
    expect(request.headers['Content-Type']).toBe('text/plain')
    expect(request.headers['x-client-timestamp']).toEqual(jasmine.any(String))
    expect(request.send).toHaveBeenCalledWith('payload')

    request.status = 204
    request.dispatchEvent(new Event('loadend'))

    expect(onResponse).toHaveBeenCalledWith({ status: 204 })
  })

  it('should send on exit with beacon when available and fallback to xhr otherwise', () => {
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      1024,
      -1,
      jasmine.createSpy('reportError')
    )

    request.sendOnExit({
      data: 'payload',
      bytesCount: 10
    })

    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      'https://example.com/rum?precision=ms',
      'payload'
    )
    expect(FakeXMLHttpRequest.instances.length).toBe(0)

    navigator.sendBeacon.and.returnValue(false)
    request.sendOnExit({
      data: 'payload',
      bytesCount: 10,
      type: 'text/plain'
    })

    const xhrRequest = FakeXMLHttpRequest.instances[0]
    expect(xhrRequest.open).toHaveBeenCalledWith(
      'POST',
      'https://example.com/rum?precision=ms',
      true
    )
    expect(xhrRequest.send).toHaveBeenCalledWith('payload')
  })

  it('should keep using beacon for FormData on exit', () => {
    const formData = new FormData()
    formData.append('segment', new Blob(['payload']), 'segment')
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      1024,
      -1,
      jasmine.createSpy('reportError')
    )

    request.sendOnExit({
      data: formData,
      bytesCount: 10
    })

    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      'https://example.com/rum?precision=ms',
      formData
    )
    expect(FakeXMLHttpRequest.instances.length).toBe(0)
  })
})
