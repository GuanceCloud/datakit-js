import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout
} from './timer'

describe('timer helpers', () => {
  let originalSetTimeout
  let originalClearTimeout
  let originalSetInterval
  let originalClearInterval

  beforeEach(() => {
    originalSetTimeout = window.setTimeout
    originalClearTimeout = window.clearTimeout
    originalSetInterval = window.setInterval
    originalClearInterval = window.clearInterval
  })

  afterEach(() => {
    window.setTimeout = originalSetTimeout
    window.clearTimeout = originalClearTimeout
    window.setInterval = originalSetInterval
    window.clearInterval = originalClearInterval
  })

  it('should delegate timeout methods to the global object', () => {
    const timeoutId = 123
    const setTimeoutSpy = jasmine
      .createSpy('setTimeout')
      .and.returnValue(timeoutId)
    const clearTimeoutSpy = jasmine.createSpy('clearTimeout')

    window.setTimeout = setTimeoutSpy
    window.clearTimeout = clearTimeoutSpy

    const callback = jasmine.createSpy('callback')
    const result = setTimeout(callback, 50)

    expect(result).toBe(timeoutId)
    expect(setTimeoutSpy).toHaveBeenCalledWith(jasmine.any(Function), 50)

    const wrappedCallback = setTimeoutSpy.calls.mostRecent().args[0]
    wrappedCallback()
    expect(callback).toHaveBeenCalled()

    clearTimeout(timeoutId)
    expect(clearTimeoutSpy).toHaveBeenCalledWith(timeoutId)
  })

  it('should delegate interval methods to the global object', () => {
    const intervalId = 456
    const setIntervalSpy = jasmine
      .createSpy('setInterval')
      .and.returnValue(intervalId)
    const clearIntervalSpy = jasmine.createSpy('clearInterval')

    window.setInterval = setIntervalSpy
    window.clearInterval = clearIntervalSpy

    const callback = jasmine.createSpy('callback')
    const result = setInterval(callback, 100)

    expect(result).toBe(intervalId)
    expect(setIntervalSpy).toHaveBeenCalledWith(jasmine.any(Function), 100)

    const wrappedCallback = setIntervalSpy.calls.mostRecent().args[0]
    wrappedCallback()
    expect(callback).toHaveBeenCalled()

    clearInterval(intervalId)
    expect(clearIntervalSpy).toHaveBeenCalledWith(intervalId)
  })
})
