import {
  MAX_TASK_TIME,
  requestIdleCallback,
  requestIdleCallbackShim
} from './requestIdleCallback'

describe('requestIdleCallback helpers', () => {
  let originalRequestIdleCallback
  let originalCancelIdleCallback
  let originalSetTimeout
  let originalClearTimeout

  beforeEach(() => {
    originalRequestIdleCallback = window.requestIdleCallback
    originalCancelIdleCallback = window.cancelIdleCallback
    originalSetTimeout = window.setTimeout
    originalClearTimeout = window.clearTimeout
  })

  afterEach(() => {
    window.requestIdleCallback = originalRequestIdleCallback
    window.cancelIdleCallback = originalCancelIdleCallback
    window.setTimeout = originalSetTimeout
    window.clearTimeout = originalClearTimeout
  })

  it('should delegate to the native requestIdleCallback implementation when available', () => {
    const idleId = 42
    const callback = jasmine.createSpy('callback')
    const requestIdleCallbackSpy = jasmine
      .createSpy('requestIdleCallback')
      .and.returnValue(idleId)
    const cancelIdleCallbackSpy = jasmine.createSpy('cancelIdleCallback')

    window.requestIdleCallback = requestIdleCallbackSpy
    window.cancelIdleCallback = cancelIdleCallbackSpy

    const stop = requestIdleCallback(callback, { timeout: 1000 })

    expect(requestIdleCallbackSpy).toHaveBeenCalledWith(
      jasmine.any(Function),
      { timeout: 1000 }
    )

    const wrappedCallback = requestIdleCallbackSpy.calls.mostRecent().args[0]
    const deadline = { didTimeout: false, timeRemaining: () => 10 }
    wrappedCallback(deadline)
    expect(callback).toHaveBeenCalledWith(deadline)

    stop()
    expect(cancelIdleCallbackSpy).toHaveBeenCalledWith(idleId)
  })

  it('should fallback to the shim and support cancellation', () => {
    const timeoutId = 7
    const callback = jasmine.createSpy('callback')
    const setTimeoutSpy = jasmine
      .createSpy('setTimeout')
      .and.returnValue(timeoutId)
    const clearTimeoutSpy = jasmine.createSpy('clearTimeout')

    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined
    window.setTimeout = setTimeoutSpy
    window.clearTimeout = clearTimeoutSpy

    const stop = requestIdleCallback(callback)

    expect(setTimeoutSpy).toHaveBeenCalledWith(jasmine.any(Function), 0)

    const scheduledCallback = setTimeoutSpy.calls.mostRecent().args[0]
    scheduledCallback()
    const deadline = callback.calls.mostRecent().args[0]

    expect(deadline.didTimeout).toBeFalse()
    expect(deadline.timeRemaining()).toBeGreaterThanOrEqual(0)
    expect(deadline.timeRemaining()).toBeLessThanOrEqual(MAX_TASK_TIME)

    stop()
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId)
  })

  it('should expose the shim as a standalone helper', () => {
    const callback = jasmine.createSpy('callback')
    const setTimeoutSpy = jasmine
      .createSpy('setTimeout')
      .and.returnValue(11)

    window.setTimeout = setTimeoutSpy

    requestIdleCallbackShim(callback)

    expect(setTimeoutSpy).toHaveBeenCalledWith(jasmine.any(Function), 0)
  })
})
