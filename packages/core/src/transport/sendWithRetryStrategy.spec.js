import {
  drainQueuedPayloads,
  getPendingPayloadsBytesCount,
  INITIAL_BACKOFF_TIME,
  MAX_ONGOING_BYTES_COUNT,
  MAX_QUEUE_BYTES_COUNT,
  newRetryState,
  ONLINE_NETWORK_ERROR_MAX_RETRIES,
  ORDERED_REQUEST_TIMEOUT,
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

  it('should bound retries for online status 0 network failures', () => {
    const state = newRetryState(-1)
    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')
    const payload = {
      bytesCount: 10,
      $rOnPermanentDrop: onPermanentDrop
    }
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((sentPayload, callback) => {
        callback({ status: 0, type: 'basic' })
      })

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })

    sendWithRetryStrategy(
      payload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    for (
      let retryIndex = 0;
      retryIndex < ONLINE_NETWORK_ERROR_MAX_RETRIES;
      retryIndex += 1
    ) {
      jasmine.clock().tick(state.currentBackoffTime)
    }

    expect(sendStrategy).toHaveBeenCalledTimes(
      ONLINE_NETWORK_ERROR_MAX_RETRIES + 1
    )
    expect(onPermanentDrop).toHaveBeenCalledOnceWith(
      'http_0'
    )
    expect(state.queuedPayloads.size()).toBe(0)
  })

  it('should recover after a transient online status 0 network failure', () => {
    const state = newRetryState(-1)
    const payload = { bytesCount: 10 }
    const responses = [
      { status: 0, type: 'basic' },
      { status: 202, type: 'basic' }
    ]
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((sentPayload, callback) => callback(responses.shift()))

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: true
    })
    sendWithRetryStrategy(
      payload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(sendStrategy).toHaveBeenCalledTimes(2)
    expect(state.queuedPayloads.size()).toBe(0)
  })

  it('should keep the online status 0 retry budget after offline failures', () => {
    const state = newRetryState(-1)
    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')
    const payload = {
      bytesCount: 10,
      $rOnPermanentDrop: onPermanentDrop
    }
    let attempts = 0
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((sentPayload, callback) => {
        attempts += 1
        Object.defineProperty(navigator, 'onLine', {
          configurable: true,
          value: attempts > 3
        })
        callback(
          attempts <= 6
            ? { status: 0, type: 'basic' }
            : { status: 202, type: 'basic' }
        )
      })

    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      value: false
    })
    sendWithRetryStrategy(
      payload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    for (let retryIndex = 0; retryIndex < 6; retryIndex += 1) {
      jasmine.clock().tick(state.currentBackoffTime)
    }

    expect(sendStrategy).toHaveBeenCalledTimes(7)
    expect(onPermanentDrop).not.toHaveBeenCalled()
    expect(state.queuedPayloads.size()).toBe(0)
  })

  it('should count a queued payload only once while it is being retried', () => {
    const state = newRetryState(-1)
    const payload = { bytesCount: 4 * 1024 * 1024 }
    let attempts = 0
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((sentPayload, callback) => {
        attempts += 1
        if (attempts === 1) {
          callback({ status: 500, type: 'basic' })
        }
      })
    spyOn(Math, 'random').and.returnValue(0)

    sendWithRetryStrategy(
      payload,
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    jasmine.clock().tick(INITIAL_BACKOFF_TIME / 2)

    expect(sendStrategy).toHaveBeenCalledTimes(2)
    expect(state.queuedPayloads.size()).toBe(1)
    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(1)
    expect(getPendingPayloadsBytesCount(state)).toBe(
      payload.bytesCount
    )
  })

  it('should apply equal jitter inside the retry backoff window', () => {
    const state = newRetryState(3)
    const responses = [
      { status: 500, type: 'basic' },
      { status: 200, type: 'basic' }
    ]
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => callback(responses.shift()))
    spyOn(Math, 'random').and.returnValue(0)

    sendWithRetryStrategy(
      { bytesCount: 10 },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    jasmine.clock().tick(INITIAL_BACKOFF_TIME / 2 - 1)
    expect(sendStrategy).toHaveBeenCalledTimes(1)

    jasmine.clock().tick(1)
    expect(sendStrategy).toHaveBeenCalledTimes(2)
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

  it('should notify a payload when a non-recoverable response drops it', () => {
    const state = newRetryState(3)
    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')

    sendWithRetryStrategy(
      { bytesCount: 10, $rOnPermanentDrop: onPermanentDrop },
      state,
      (payload, callback) => callback({ status: 400, type: 'basic' }),
      '/rum',
      jasmine.createSpy('reportError')
    )

    expect(onPermanentDrop).toHaveBeenCalledOnceWith('http_400')
  })

  it('should notify a payload once when its retry limit is exhausted', () => {
    const state = newRetryState(0)
    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')
    const sendStrategy = (payload, callback) =>
      callback({ status: 500, type: 'basic' })

    sendWithRetryStrategy(
      { bytesCount: 10, $rOnPermanentDrop: onPermanentDrop },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(onPermanentDrop).toHaveBeenCalledOnceWith('retry_exhausted')
    expect(state.queuedPayloads.size()).toBe(0)
  })

  it('should notify a payload rejected by the retry queue', () => {
    const state = newRetryState(3)
    const callbacks = []
    const sendStrategy = (payload, callback) => {
      callbacks.push(callback)
    }
    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')

    sendWithRetryStrategy(
      { bytesCount: MAX_ONGOING_BYTES_COUNT },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      { bytesCount: MAX_QUEUE_BYTES_COUNT },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      { bytesCount: 1, $rOnPermanentDrop: onPermanentDrop },
      state,
      sendStrategy,
      '/rum',
      jasmine.createSpy('reportError')
    )

    expect(callbacks).toHaveSize(1)
    expect(onPermanentDrop).toHaveBeenCalledOnceWith('queue_full')
  })

  it('should reclaim an invalid queued generation before dropping a new valid payload', () => {
    const state = newRetryState(3)
    const attempts = []
    const callbacks = []
    const sendStrategy = (payload, callback) => {
      attempts.push(payload)
      callbacks.push(callback)
    }
    const activePayload = { bytesCount: MAX_ONGOING_BYTES_COUNT }
    let staleGenerationValid = true
    const stalePayload = {
      bytesCount: MAX_QUEUE_BYTES_COUNT,
      $rEnforceOrder: true,
      $rIsValid: () => staleGenerationValid
    }
    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')
    const nextPayload = {
      bytesCount: 1,
      $rEnforceOrder: true,
      $rOnPermanentDrop: onPermanentDrop
    }

    sendWithRetryStrategy(
      activePayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      stalePayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    staleGenerationValid = false
    sendWithRetryStrategy(
      nextPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    expect(onPermanentDrop).not.toHaveBeenCalled()
    expect(state.queuedPayloads.size()).toBe(1)
    expect(state.queuedPayloads.first()).toBe(nextPayload)
    expect(state.$rPayloadSequenceByPayload.has(stalePayload)).toBeFalse()

    callbacks[0]({ status: 200, type: 'basic' })
    expect(attempts).toEqual([activePayload, nextPayload])
    callbacks[1]({ status: 200, type: 'basic' })
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })

  it('should preserve a valid tail while pruning an oversized ordered queue', () => {
    const state = newRetryState(3)
    const sendStrategy = jasmine.createSpy('sendStrategy')
    const activePayload = { bytesCount: MAX_ONGOING_BYTES_COUNT }
    sendWithRetryStrategy(
      activePayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    const orderedHead = {
      bytesCount: MAX_QUEUE_BYTES_COUNT,
      $rEnforceOrder: true
    }
    const invalidMiddle = {
      bytesCount: 1,
      $rIsValid: () => false
    }
    const validTail = { bytesCount: 1, $rEnforceOrder: true }
    ;[orderedHead, invalidMiddle, validTail].forEach(
      (payload, index) =>
        state.$rPayloadSequenceByPayload.set(payload, index + 1)
    )
    state.$rNextPayloadSequence = 4
    expect(state.queuedPayloads.enqueue(invalidMiddle)).toBeTrue()
    expect(state.queuedPayloads.enqueue(validTail)).toBeTrue()
    expect(state.queuedPayloads.enqueueFirst(orderedHead)).toBeTrue()
    expect(state.queuedPayloads.bytesCount).toBe(
      MAX_QUEUE_BYTES_COUNT + 2
    )

    const onPermanentDrop = jasmine.createSpy('onPermanentDrop')
    const rejectedPayload = {
      bytesCount: 1,
      $rOnPermanentDrop: onPermanentDrop
    }
    sendWithRetryStrategy(
      rejectedPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    expect(onPermanentDrop).toHaveBeenCalledOnceWith('queue_full')
    expect(state.queuedPayloads.size()).toBe(2)
    expect(state.queuedPayloads.dequeue()).toBe(orderedHead)
    expect(state.queuedPayloads.dequeue()).toBe(validTail)
    expect(state.$rPayloadSequenceByPayload.has(orderedHead)).toBeTrue()
    expect(state.$rPayloadSequenceByPayload.has(validTail)).toBeTrue()
    expect(state.$rPayloadSequenceByPayload.has(invalidMiddle)).toBeFalse()
    expect(state.$rPayloadSequenceByPayload.has(rejectedPayload)).toBeFalse()

    drainQueuedPayloads(state)
  })

  it('should abort a hung invalid ordered generation after the retry queue fills', () => {
    const state = newRetryState(3)
    const attempts = []
    let firstResponse
    let generationValid = true
    const abort = jasmine.createSpy('abort').and.callFake(() => {
      firstResponse({ status: 0, $rForceRetry: true })
    })
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        attempts.push(payload)
        if (attempts.length === 1) {
          firstResponse = callback
          return { abort }
        }
        return { abort: jasmine.createSpy('replacementAbort') }
      })
    const reportError = jasmine.createSpy('reportError')
    const sharedProperties = {
      $rEnforceOrder: true,
      $rIsValid: () => generationValid
    }
    const hungPayload = { ...sharedProperties, bytesCount: 10 }
    const queuedPayload = {
      ...sharedProperties,
      bytesCount: MAX_QUEUE_BYTES_COUNT
    }
    const onPermanentDrop = jasmine
      .createSpy('onPermanentDrop')
      .and.callFake(() => {
        generationValid = false
      })
    const rejectedPayload = {
      ...sharedProperties,
      bytesCount: 1,
      $rOnPermanentDrop: onPermanentDrop
    }

    sendWithRetryStrategy(
      hungPayload,
      state,
      sendStrategy,
      '/replay',
      reportError
    )
    sendWithRetryStrategy(
      queuedPayload,
      state,
      sendStrategy,
      '/replay',
      reportError
    )
    sendWithRetryStrategy(
      rejectedPayload,
      state,
      sendStrategy,
      '/replay',
      reportError
    )

    expect(onPermanentDrop).toHaveBeenCalledOnceWith('queue_full')
    expect(abort).toHaveBeenCalledTimes(1)
    expect(attempts).toEqual([hungPayload])
    expect(state.$rOngoingRequests.size).toBe(0)
    expect(state.bandwidthMonitor.ongoingRequestCount).toBe(0)
    expect(state.bandwidthMonitor.ongoingOrderedRequestCount).toBe(0)
    expect(state.bandwidthMonitor.ongoingByteCount).toBe(0)
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
    expect(state.transportStatus).toBe(0)

    jasmine.clock().tick(INITIAL_BACKOFF_TIME)
    expect(sendStrategy).toHaveBeenCalledTimes(1)

    const replacementPayload = {
      bytesCount: 10,
      $rEnforceOrder: true,
      $rIsValid: () => true
    }
    sendWithRetryStrategy(
      replacementPayload,
      state,
      sendStrategy,
      '/replay',
      reportError
    )

    expect(attempts).toEqual([hungPayload, replacementPayload])
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.$rOngoingRequests.size).toBe(1)
  })

  it('should time out a hung ordered request and retry it before its dependent tail', () => {
    const state = newRetryState(3)
    const attempts = []
    const callbacks = []
    const aborts = []
    const firstPayload = { bytesCount: 10, $rEnforceOrder: true }
    const secondPayload = { bytesCount: 10, $rEnforceOrder: true }
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        const abort = jasmine.createSpy('abort')
        attempts.push(payload)
        callbacks.push(callback)
        aborts.push(abort)
        return { abort }
      })

    sendWithRetryStrategy(
      firstPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      secondPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    expect(attempts).toEqual([firstPayload])
    expect(state.queuedPayloads.first()).toBe(secondPayload)

    jasmine.clock().tick(ORDERED_REQUEST_TIMEOUT)

    expect(aborts[0]).toHaveBeenCalledTimes(1)
    expect(state.$rOngoingRequests.size).toBe(0)
    expect(state.bandwidthMonitor.ongoingOrderedRequestCount).toBe(0)
    expect(state.queuedPayloads.size()).toBe(2)
    expect(state.queuedPayloads.first()).toBe(firstPayload)
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(attempts).toEqual([firstPayload, firstPayload])
    callbacks[1]({ status: 200, type: 'basic' })
    expect(attempts).toEqual([firstPayload, firstPayload, secondPayload])
    callbacks[2]({ status: 200, type: 'basic' })
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.$rOngoingRequests.size).toBe(0)
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })

  it('should keep ordered dependents behind a payload and skip them when its generation is invalidated', () => {
    const state = newRetryState(3)
    const callbacks = []
    let generationValid = true
    const onPermanentDrop = jasmine
      .createSpy('onPermanentDrop')
      .and.callFake(() => {
        generationValid = false
      })
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => callbacks.push(callback))
    const sharedProperties = {
      bytesCount: 10,
      $rEnforceOrder: true,
      $rIsValid: () => generationValid
    }

    sendWithRetryStrategy(
      { ...sharedProperties, $rOnPermanentDrop: onPermanentDrop },
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      { ...sharedProperties },
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    expect(sendStrategy).toHaveBeenCalledTimes(1)
    expect(state.queuedPayloads.size()).toBe(1)

    callbacks[0]({ status: 400, type: 'basic' })

    expect(onPermanentDrop).toHaveBeenCalledOnceWith('http_400')
    expect(sendStrategy).toHaveBeenCalledTimes(1)
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })

  it('should retry a failed ordered payload before later queued payloads', () => {
    const state = newRetryState(3)
    const firstPayload = { bytesCount: 10, $rEnforceOrder: true }
    const secondPayload = { bytesCount: 10, $rEnforceOrder: true }
    const attempts = []
    const callbacks = []
    const sendStrategy = jasmine
      .createSpy('sendStrategy')
      .and.callFake((payload, callback) => {
        attempts.push(payload)
        callbacks.push(callback)
      })

    sendWithRetryStrategy(
      firstPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      secondPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    callbacks[0]({ status: 500, type: 'basic' })
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(attempts).toEqual([firstPayload, firstPayload])
    callbacks[1]({ status: 200, type: 'basic' })

    expect(attempts).toEqual([
      firstPayload,
      firstPayload,
      secondPayload
    ])
  })

  it('should discard payloads invalidated while waiting for an ordered retry', () => {
    const state = newRetryState(3)
    const attempts = []
    const callbacks = []
    let generationValid = true
    const invalidatedPayload = {
      bytesCount: 10,
      $rEnforceOrder: true,
      $rIsValid: () => generationValid
    }
    const validPayload = { bytesCount: 10, $rEnforceOrder: true }
    const sendStrategy = (payload, callback) => {
      attempts.push(payload)
      callbacks.push(callback)
    }

    sendWithRetryStrategy(
      invalidatedPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    sendWithRetryStrategy(
      validPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )

    callbacks[0]({ status: 500, type: 'basic' })
    generationValid = false
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(attempts).toEqual([invalidatedPayload, validPayload])
    expect(state.queuedPayloads.size()).toBe(1)
    expect(state.queuedPayloads.first()).toBe(validPayload)

    callbacks[1]({ status: 200, type: 'basic' })
    expect(state.queuedPayloads.size()).toBe(0)
    expect(state.$rPayloadSequenceByPayload.size).toBe(0)
  })

  it('should restart recovery when an invalid retry leaves the transport down and a new payload arrives', () => {
    const state = newRetryState(3)
    const attempts = []
    const callbacks = []
    let generationValid = true
    const invalidatedPayload = {
      bytesCount: 10,
      $rEnforceOrder: true,
      $rIsValid: () => generationValid
    }
    const validPayload = { bytesCount: 10, $rEnforceOrder: true }
    const sendStrategy = (payload, callback) => {
      attempts.push(payload)
      callbacks.push(callback)
    }

    sendWithRetryStrategy(
      invalidatedPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    callbacks[0]({ status: 500, type: 'basic' })
    generationValid = false
    jasmine.clock().tick(INITIAL_BACKOFF_TIME)

    expect(state.transportStatus).toBe(2)
    expect(state.queuedPayloads.size()).toBe(0)

    sendWithRetryStrategy(
      validPayload,
      state,
      sendStrategy,
      '/replay',
      jasmine.createSpy('reportError')
    )
    expect(state.queuedPayloads.first()).toBe(validPayload)

    jasmine.clock().tick(INITIAL_BACKOFF_TIME * 2)
    expect(attempts).toEqual([invalidatedPayload, validPayload])
    callbacks[1]({ status: 200, type: 'basic' })
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
