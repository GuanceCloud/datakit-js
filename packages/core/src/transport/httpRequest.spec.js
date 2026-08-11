import { createHttpRequest, fetchStrategyWithFallback } from './httpRequest'
import { INITIAL_BACKOFF_TIME } from './sendWithRetryStrategy'

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
      this.abort = jasmine.createSpy('abort').and.callFake(() => {
        this.dispatchEvent(new Event('loadend'))
      })
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

    const beaconResult = request.sendOnExit({
      data: 'payload',
      bytesCount: 10
    })

    expect(navigator.sendBeacon).toHaveBeenCalledWith(
      'https://example.com/rum?precision=ms',
      'payload'
    )
    expect(FakeXMLHttpRequest.instances.length).toBe(0)
    expect(beaconResult).toBeUndefined()

    navigator.sendBeacon.and.returnValue(false)
    const xhrResult = request.sendOnExit({
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
    expect(xhrResult).toBeUndefined()
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

  it('should not drain ordinary retry state when exit has no byte budget', async () => {
    var resolveOngoingRequest
    const signals = []
    window.fetch = jasmine
      .createSpy('fetch')
      .and.callFake(function (_url, options) {
        signals.push(options.signal)
        return new Promise(function (resolve) {
          resolveOngoingRequest = resolve
        })
      })
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    request.send({
      data: 'ordinary-in-flight',
      bytesCount: 10
    })
    const result = request.sendOnExit({
      data: 'current-exit',
      bytesCount: 10
    })

    expect(signals[0].aborted).toBe(false)
    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'current-exit']
    ])
    expect(result).toBeUndefined()

    resolveOngoingRequest({ status: 200, type: 'basic' })
    await Promise.resolve()
    await Promise.resolve()
  })

  it('should not beacon an ordered non-terminal exit past an older in-flight payload', async () => {
    var resolveOlderRequest
    var generationValid = true
    const onPermanentDrop = jasmine
      .createSpy('onPermanentDrop')
      .and.callFake(function () {
        generationValid = false
      })
    window.fetch = jasmine.createSpy('fetch').and.callFake(function () {
      return new Promise(function (resolve) {
        resolveOlderRequest = resolve
      })
    })
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/replay',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )
    const orderedProperties = {
      bytesCount: 10,
      $rEnforceOrder: true,
      $rIsValid: () => generationValid
    }

    request.send({
      ...orderedProperties,
      data: 'older-segment',
      $rOnPermanentDrop: onPermanentDrop
    })
    request.sendOnExit({
      ...orderedProperties,
      data: 'hidden-dependent-tail'
    })

    expect(window.fetch).toHaveBeenCalledTimes(1)
    expect(navigator.sendBeacon).not.toHaveBeenCalled()

    resolveOlderRequest({ status: 400, type: 'basic' })
    await Promise.resolve()
    await Promise.resolve()

    expect(onPermanentDrop).toHaveBeenCalledOnceWith('http_400')
    expect(window.fetch).toHaveBeenCalledTimes(1)
    expect(navigator.sendBeacon).not.toHaveBeenCalled()
  })

  it('should explicitly drain retry payloads once without a current exit payload', () => {
    const signals = []
    window.fetch = jasmine
      .createSpy('fetch')
      .and.callFake(function (_url, options) {
        signals.push(options.signal)
        return new Promise(function () {})
      })
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    request.send({
      data: 'older-segment',
      bytesCount: 10,
      $rExitBytesCount: 12
    })

    const firstResult = request.$rDrainOnExit(100)
    const secondResult = request.$rDrainOnExit(100)

    expect(signals[0].aborted).toBe(true)
    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'older-segment']
    ])
    expect(firstResult).toEqual({
      $rBytesCount: 12,
      $rAllPayloadsSent: true
    })
    expect(secondResult).toEqual({
      $rBytesCount: 0,
      $rAllPayloadsSent: true
    })
  })

  it('should promote ordinary in-flight and queued payloads once on budgeted exit', async () => {
    var resolveOngoingRequests = []
    window.fetch = jasmine
      .createSpy('fetch')
      .and.callFake(function () {
        return new Promise(function (resolve) {
          resolveOngoingRequests.push(resolve)
        })
      })
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    request.send({
      data: 'ongoing-1',
      bytesCount: 30000
    })
    request.send({
      data: 'ongoing-2',
      bytesCount: 30000
    })
    request.send({
      data: 'queued',
      bytesCount: 30000
    })

    expect(window.fetch).toHaveBeenCalledTimes(2)
    expect(navigator.sendBeacon).not.toHaveBeenCalled()

    request.sendOnExit(
      {
        data: 'tail',
        bytesCount: 10
      },
      200000
    )

    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'ongoing-1'],
      ['https://example.com/rum?precision=ms', 'ongoing-2'],
      ['https://example.com/rum?precision=ms', 'queued'],
      ['https://example.com/rum?precision=ms', 'tail']
    ])

    request.sendOnExit(
      {
        data: 'second-tail',
        bytesCount: 10
      },
      200000
    )
    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'ongoing-1'],
      ['https://example.com/rum?precision=ms', 'ongoing-2'],
      ['https://example.com/rum?precision=ms', 'queued'],
      ['https://example.com/rum?precision=ms', 'tail'],
      ['https://example.com/rum?precision=ms', 'second-tail']
    ])

    request.send({
      data: 'after-exit',
      bytesCount: 10
    })
    expect(window.fetch).toHaveBeenCalledTimes(3)
    expect(window.fetch.calls.mostRecent().args[1].body).toBe('after-exit')

    resolveOngoingRequests[0]({ status: 200, type: 'basic' })
    resolveOngoingRequests[1]({ status: 200, type: 'basic' })
    await Promise.resolve()
    await Promise.resolve()
  })

  it('should keep an ordered exit prefix within a shared byte budget', () => {
    const signals = []
    window.fetch = jasmine
      .createSpy('fetch')
      .and.callFake(function (_url, options) {
        signals.push(options.signal)
        return new Promise(function () {})
      })
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    request.send({
      data: 'older-segment',
      bytesCount: 55000,
      $rExitBytesCount: 57048
    })
    const result = request.sendOnExit(
      {
        data: 'final-segment',
        bytesCount: 10000,
        $rExitBytesCount: 12048
      },
      60000
    )

    expect(signals[0].aborted).toBe(true)
    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'older-segment']
    ])
    expect(result).toEqual({
      $rBytesCount: 57048,
      $rCurrentPayloadSent: false
    })
  })

  it('should preserve submission order when an older failure is queued behind a younger ongoing request', async () => {
    var resolveOlderRequest
    window.fetch = jasmine
      .createSpy('fetch')
      .and.returnValues(
        new Promise(function (resolve) {
          resolveOlderRequest = resolve
        }),
        new Promise(function () {})
      )
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    request.send({ data: 'older-failed', bytesCount: 10 })
    request.send({ data: 'younger-ongoing', bytesCount: 10 })
    resolveOlderRequest({ status: 500, type: 'basic' })
    await Promise.resolve()
    await Promise.resolve()

    request.sendOnExit({ data: 'current-tail', bytesCount: 10 }, 100)

    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'older-failed'],
      ['https://example.com/rum?precision=ms', 'younger-ongoing'],
      ['https://example.com/rum?precision=ms', 'current-tail']
    ])
  })

  it('should report actual consumption across repeated budgeted exit sends', () => {
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )
    let remainingBytes = 25

    const firstResult = request.sendOnExit(
      { data: 'tail-1', bytesCount: 10 },
      remainingBytes
    )
    remainingBytes -= firstResult.$rBytesCount
    const secondResult = request.sendOnExit(
      { data: 'tail-2', bytesCount: 10 },
      remainingBytes
    )
    remainingBytes -= secondResult.$rBytesCount
    const thirdResult = request.sendOnExit(
      { data: 'tail-3', bytesCount: 10 },
      remainingBytes
    )

    expect(firstResult).toEqual({
      $rBytesCount: 10,
      $rCurrentPayloadSent: true
    })
    expect(secondResult).toEqual({
      $rBytesCount: 10,
      $rCurrentPayloadSent: true
    })
    expect(thirdResult).toEqual({
      $rBytesCount: 0,
      $rCurrentPayloadSent: false
    })
    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'tail-1'],
      ['https://example.com/rum?precision=ms', 'tail-2']
    ])
  })

  it('should abort every unresolved fetch before promoting it on repeated exits', () => {
    const signals = []
    window.fetch = jasmine
      .createSpy('fetch')
      .and.callFake(function (url, options) {
        signals.push(options.signal)
        return new Promise(function () {})
      })
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    for (let index = 0; index < 3; index += 1) {
      request.send({
        data: 'ongoing-' + index,
        bytesCount: 10
      })
      request.sendOnExit(
        {
          data: 'tail-' + index,
          bytesCount: 10
        },
        200000
      )
    }

    expect(window.fetch).toHaveBeenCalledTimes(3)
    expect(signals.length).toBe(3)
    signals.forEach(function (signal) {
      expect(signal).toBeDefined()
      expect(signal.aborted).toBe(true)
    })
    expect(navigator.sendBeacon).toHaveBeenCalledTimes(6)
  })

  it('should abort an unresolved xhr before promoting it on exit', () => {
    window.fetch = undefined
    navigator.sendBeacon = jasmine.createSpy('sendBeacon').and.returnValue(true)
    const request = createHttpRequest(
      'https://example.com/rum',
      200000,
      -1,
      jasmine.createSpy('reportError')
    )

    request.send({
      data: 'ongoing',
      bytesCount: 10
    })
    const xhrRequest = FakeXMLHttpRequest.instances[0]

    request.sendOnExit(
      {
        data: 'tail',
        bytesCount: 10
      },
      200000
    )

    expect(xhrRequest.abort).toHaveBeenCalledTimes(1)
    expect(navigator.sendBeacon.calls.allArgs()).toEqual([
      ['https://example.com/rum?precision=ms', 'ongoing'],
      ['https://example.com/rum?precision=ms', 'tail']
    ])

    request.send({
      data: 'current-generation',
      bytesCount: 10
    })
    expect(FakeXMLHttpRequest.instances.length).toBe(2)
  })

  it('should promote a payload while its retry fetch is in flight', async () => {
    jasmine.clock().install()
    var resolveRetryRequest
    try {
      window.fetch = jasmine
        .createSpy('fetch')
        .and.returnValues(
          Promise.resolve({ status: 500, type: 'basic' }),
          new Promise(function (resolve) {
            resolveRetryRequest = resolve
          }),
          new Promise(function () {})
        )
      navigator.sendBeacon = jasmine
        .createSpy('sendBeacon')
        .and.returnValue(true)
      const request = createHttpRequest(
        'https://example.com/rum',
        200000,
        -1,
        jasmine.createSpy('reportError')
      )

      request.send({
        data: 'retrying',
        bytesCount: 10
      })
      await Promise.resolve()
      await Promise.resolve()
      jasmine.clock().tick(INITIAL_BACKOFF_TIME)

      expect(window.fetch).toHaveBeenCalledTimes(2)
      expect(window.fetch.calls.mostRecent().args[1].body).toBe('retrying')

      request.send({
        data: 'queued-behind-retry',
        bytesCount: 10
      })
      request.sendOnExit(
        {
          data: 'tail',
          bytesCount: 10
        },
        200000
      )

      expect(navigator.sendBeacon.calls.allArgs()).toEqual([
        ['https://example.com/rum?precision=ms', 'retrying'],
        [
          'https://example.com/rum?precision=ms',
          'queued-behind-retry'
        ],
        ['https://example.com/rum?precision=ms', 'tail']
      ])

      resolveRetryRequest({ status: 200, type: 'basic' })
      await Promise.resolve()
      await Promise.resolve()

      expect(window.fetch).toHaveBeenCalledTimes(2)
      expect(
        navigator.sendBeacon.calls
          .allArgs()
          .filter(function (args) {
            return args[1] === 'retrying'
          })
          .length
      ).toBe(1)

      request.send({
        data: 'after-retry',
        bytesCount: 10
      })
      expect(window.fetch).toHaveBeenCalledTimes(3)
      expect(window.fetch.calls.mostRecent().args[1].body).toBe(
        'after-retry'
      )
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should cancel a scheduled retry when queued payloads are promoted on exit', async () => {
    jasmine.clock().install()
    try {
      window.fetch = jasmine
        .createSpy('fetch')
        .and.returnValues(
          Promise.resolve({ status: 500, type: 'basic' }),
          new Promise(function () {})
        )
      navigator.sendBeacon = jasmine
        .createSpy('sendBeacon')
        .and.returnValue(true)
      const request = createHttpRequest(
        'https://example.com/rum',
        200000,
        -1,
        jasmine.createSpy('reportError')
      )

      request.send({
        data: 'retrying',
        bytesCount: 10
      })
      await Promise.resolve()
      await Promise.resolve()

      request.sendOnExit(
        {
          data: 'tail',
          bytesCount: 10
        },
        200000
      )
      expect(navigator.sendBeacon.calls.allArgs()).toEqual([
        ['https://example.com/rum?precision=ms', 'retrying'],
        ['https://example.com/rum?precision=ms', 'tail']
      ])

      jasmine.clock().tick(INITIAL_BACKOFF_TIME)
      expect(window.fetch).toHaveBeenCalledTimes(1)

      request.send({
        data: 'after-exit',
        bytesCount: 10
      })
      expect(window.fetch).toHaveBeenCalledTimes(2)
      expect(window.fetch.calls.mostRecent().args[1].body).toBe(
        'after-exit'
      )
    } finally {
      jasmine.clock().uninstall()
    }
  })

  it('should ignore a stale in-flight failure after promoting its queued tail', async () => {
    jasmine.clock().install()
    var resolveInFlightRequest
    var resolveCurrentRequest
    try {
      window.fetch = jasmine
        .createSpy('fetch')
        .and.returnValues(
          new Promise(function (resolve) {
            resolveInFlightRequest = resolve
          }),
          new Promise(function (resolve) {
            resolveCurrentRequest = resolve
          }),
          new Promise(function () {})
        )
      navigator.sendBeacon = jasmine
        .createSpy('sendBeacon')
        .and.returnValue(true)
      const request = createHttpRequest(
        'https://example.com/rum',
        200000,
        -1,
        jasmine.createSpy('reportError')
      )

      request.send({
        data: 'in-flight',
        bytesCount: 40000
      })
      request.send({
        data: 'queued',
        bytesCount: 50000
      })
      request.sendOnExit(
        {
          data: 'tail',
          bytesCount: 10
        },
        200000
      )

      request.send({
        data: 'current-generation',
        bytesCount: 10
      })
      expect(window.fetch).toHaveBeenCalledTimes(2)
      expect(window.fetch.calls.mostRecent().args[1].body).toBe(
        'current-generation'
      )

      resolveInFlightRequest({ status: 500, type: 'basic' })
      await Promise.resolve()
      await Promise.resolve()
      jasmine.clock().tick(INITIAL_BACKOFF_TIME)

      expect(window.fetch).toHaveBeenCalledTimes(2)
      expect(navigator.sendBeacon.calls.allArgs()).toEqual([
        ['https://example.com/rum?precision=ms', 'in-flight'],
        ['https://example.com/rum?precision=ms', 'queued'],
        ['https://example.com/rum?precision=ms', 'tail']
      ])

      resolveCurrentRequest({ status: 200, type: 'basic' })
      await Promise.resolve()
      await Promise.resolve()

      request.send({
        data: 'after-stale-failure',
        bytesCount: 10
      })
      expect(window.fetch).toHaveBeenCalledTimes(3)
      expect(window.fetch.calls.mostRecent().args[1].body).toBe(
        'after-stale-failure'
      )
    } finally {
      jasmine.clock().uninstall()
    }
  })
})
