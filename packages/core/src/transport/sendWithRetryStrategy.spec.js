import {
  INITIAL_BACKOFF_TIME,
  MAX_ONGOING_BYTES_COUNT,
  newRetryState,
  sendWithRetryStrategy
} from './sendWithRetryStrategy'

describe('sendWithRetryStrategy', () => {
  let originalOnline

  beforeEach(() => {
    jasmine.clock().install()
    originalOnline = navigator.onLine
  })

  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: originalOnline
    })
    jasmine.clock().uninstall()
  })

  it('should send immediately when bandwidth is available and the request succeeds', () => {
    const state = newRetryState(3)
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        callback({ status: 200, type: 'basic' })
      })

    sendWithRetryStrategy(
      { bytesCount: 10 },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )

    expect(sendStrategy).toHaveBeenCalledTimes(1)
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.transportStatus).toBe(0)
  })

  it('should queue a payload and retry it after a recoverable failure', () => {
    const state = newRetryState(3)
    const responses = [
      { status: 0, type: 'basic' },
      { status: 200, type: 'basic' }
    ]
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        callback(responses.shift())
      })

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false
    })

    sendWithRetryStrategy(
      { bytesCount: 10 },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )

    expect(state.queuedPayloads.size()).toBe(1)
    expect(state.transportStatus).toBe(2)

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(sendStrategy).toHaveBeenCalledTimes(2)
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.transportStatus).toBe(0)
    expect(state.currentBackoffTime).toBe(INITIAL_BACKOFF_TIME)
  })

  it('should not retry non-recoverable responses', () => {
    const state = newRetryState(3)
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        callback({ status: 400, type: 'basic' })
      })

    sendWithRetryStrategy(
      { bytesCount: 10 },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )

    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(sendStrategy).toHaveBeenCalledTimes(1)
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.transportStatus).toBe(0)
  })

  it('should queue payloads when bandwidth is saturated and retry them after the ongoing request succeeds', () => {
    const state = newRetryState(3)
    const callbacks = []
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        callbacks.push(callback)
      })

    sendWithRetryStrategy(
      { bytesCount: MAX_ONGOING_BYTES_COUNT },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      { bytesCount: 1 },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )

    expect(sendStrategy).toHaveBeenCalledTimes(1)
    expect(state.queuedPayloads.size()).toBe(1)

    callbacks[0]({ status: 200, type: 'basic' })

    expect(sendStrategy).toHaveBeenCalledTimes(2)
    expect(state.queuedPayloads.size()).toBe(0)
  })
})
