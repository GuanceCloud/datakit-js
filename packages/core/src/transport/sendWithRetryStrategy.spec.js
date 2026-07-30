import {
  drainQueuedPayloads,
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

  it('should retry a synchronous send strategy throw while online', () => {
    const state = newRetryState(3)
    const payload = { bytesCount: 10 }
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.throwError('send failed')

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })

    expect(() =>
      sendWithRetryStrategy(
        payload,
        state,
        sendStrategy,
        '/rum',
        jasmine.createSpy('reportError')
      )
    ).not.toThrow()

    expect(state.$rOngoingRequests.size).toBe(0)
    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(0)
    expect(state.bandwidthMonitor.ongoingByteCount).toBe(0)
    expect(state.queuedPayloads.size()).toBe(1)
    expect(payload.retry).toEqual({
      count: 1,
      lastFailureStatus: 0
    })
    expect(state.$rPayloadSequenceByPayload.size).toBe(1)
    expect(drainQueuedPayloads(state)).toEqual([payload])
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })

  it('should settle once when the send strategy responds and then throws', () => {
    const state = newRetryState(3)
    const payload = { bytesCount: 10 }
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((currentPayload, callback) => {
        callback({ status: 500, type: 'basic' })
        throw new Error('send failed after response')
      })

    expect(() =>
      sendWithRetryStrategy(
        payload,
        state,
        sendStrategy,
        '/rum',
        jasmine.createSpy('reportError')
      )
    ).not.toThrow()

    expect(state.$rOngoingRequests.size).toBe(0)
    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(0)
    expect(state.bandwidthMonitor.ongoingByteCount).toBe(0)
    expect(state.queuedPayloads.size()).toBe(1)
    expect(state.queuedPayloads.bytesCount).toBe(payload.bytesCount)
    expect(state.$rPayloadSequenceByPayload.size).toBe(1)
    expect(drainQueuedPayloads(state)).toEqual([payload])
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })

  it('should cancel drained requests before ignoring their synchronous response', () => {
    const state = newRetryState(3)
    const payload = { bytesCount: 10 }
    let onResponse
    const abort = jasmine.createSpy('abort').and.callFake(() => {
      onResponse({ status: 500, type: 'basic' })
    })
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((currentPayload, callback) => {
        onResponse = callback
        return { abort }
      })

    sendWithRetryStrategy(
      payload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )

    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(1)
    expect(drainQueuedPayloads(state)).toEqual([payload])
    expect(abort).toHaveBeenCalledTimes(1)
    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(0)
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.transportStatus).toBe(0)

    expect(drainQueuedPayloads(state)).toEqual([])
    expect(abort).toHaveBeenCalledTimes(1)
  })

  it('should keep draining when an abort handle is invalid or throws', () => {
    const state = newRetryState(3)
    const payloads = [
      { bytesCount: 10 },
      { bytesCount: 10 },
      { bytesCount: 10 }
    ]
    const finalAbort = jasmine.createSpy('finalAbort')
    const handles = [
      {
        abort() {
          throw new Error('abort failed')
        }
      },
      {},
      { abort: finalAbort }
    ]
    const sendStrategy = (payload, callback) => handles.shift()

    payloads.forEach((payload) =>
      sendWithRetryStrategy(
        payload,
        state,
        sendStrategy,
        '/rum',
        jasmine.createSpy('reportError')
      )
    )

    expect(drainQueuedPayloads(state)).toEqual(payloads)
    expect(finalAbort).toHaveBeenCalledTimes(1)
    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(0)
  })

  it('should drain a failed older payload before a younger ongoing payload', () => {
    const state = newRetryState(3)
    const callbacks = []
    const abort = jasmine.createSpy('abort')
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        callbacks.push(callback)
        return { abort }
      })
    const olderPayload = { bytesCount: 10 }
    const youngerPayload = { bytesCount: 10 }

    sendWithRetryStrategy(
      olderPayload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      youngerPayload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    callbacks[0]({ status: 500, type: 'basic' })

    expect(drainQueuedPayloads(state)).toEqual([
      olderPayload,
      youngerPayload
    ])
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })
})
