import {
  isLayoutShiftSupported,
  trackCumulativeLayoutShift
} from './trackCumulativeLayoutShift'

describe('trackCumulativeLayoutShift', () => {
  let OriginalPerformanceObserver

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe')
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instance = this
    }
  }

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    FakePerformanceObserver.instance = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should report layout shift support based on supported entry types', () => {
    FakePerformanceObserver.supportedEntryTypes = []
    expect(isLayoutShiftSupported()).toBeFalse()

    FakePerformanceObserver.supportedEntryTypes = ['layout-shift']
    expect(isLayoutShiftSupported()).toBe('WeakRef' in window)
  })

  it('should return a noop tracker when layout-shift is not supported', () => {
    FakePerformanceObserver.supportedEntryTypes = []
    const callback = jasmine.createSpy('callback')

    const tracking = trackCumulativeLayoutShift({}, 0, callback)

    expect(callback).not.toHaveBeenCalled()
    expect(() => tracking.stop()).not.toThrow()
  })

  it('should report initial zero and track max cls with selector and time', () => {
    FakePerformanceObserver.supportedEntryTypes = ['layout-shift']
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('div')
    target.setAttribute('data-testid', 'cls-target')
    document.body.appendChild(target)

    const tracking = trackCumulativeLayoutShift({}, 10, callback)

    expect(callback).toHaveBeenCalledWith({ value: 0 })

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            startTime: 5,
            value: 0.2,
            hadRecentInput: false,
            sources: [{ node: target }]
          },
          {
            startTime: 20,
            value: 0.12555,
            hadRecentInput: true,
            sources: [{ node: target }]
          },
          {
            startTime: 30,
            value: 0.12345,
            hadRecentInput: false,
            sources: [{ node: target }]
          }
        ]
      }
    })

    expect(callback.calls.mostRecent().args[0]).toEqual({
      value: 0.1235,
      targetSelector: 'DIV[data-testid="cls-target"]',
      time: 20
    })

    tracking.stop()
    expect(FakePerformanceObserver.instance.disconnect).toHaveBeenCalled()
    target.remove()
  })

  it('should accumulate cls values within the same session window and omit selector when no element source exists', () => {
    FakePerformanceObserver.supportedEntryTypes = ['layout-shift']
    const callback = jasmine.createSpy('callback')

    trackCumulativeLayoutShift({}, 0, callback)

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            startTime: 10,
            value: 0.1,
            hadRecentInput: false,
            sources: [{ node: document.createTextNode('ignored') }]
          },
          {
            startTime: 200,
            value: 0.2,
            hadRecentInput: false,
            sources: [{ node: document.createTextNode('ignored') }]
          }
        ]
      }
    })

    expect(callback.calls.mostRecent().args[0]).toEqual({
      value: 0.3,
      targetSelector: undefined,
      time: 200
    })
  })

  it('should start a new session window after a long gap without replacing the current max', () => {
    FakePerformanceObserver.supportedEntryTypes = ['layout-shift']
    const callback = jasmine.createSpy('callback')

    trackCumulativeLayoutShift({}, 0, callback)

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            startTime: 10,
            value: 0.3,
            hadRecentInput: false
          },
          {
            startTime: 1500,
            value: 0.1,
            hadRecentInput: false
          }
        ]
      }
    })

    expect(callback.calls.count()).toBe(2)
    expect(callback.calls.mostRecent().args[0]).toEqual({
      value: 0.3,
      targetSelector: undefined,
      time: 10
    })
  })

  it('should ignore layout shifts that happen before the current view start', () => {
    FakePerformanceObserver.supportedEntryTypes = ['layout-shift']
    const callback = jasmine.createSpy('callback')

    trackCumulativeLayoutShift({}, 50, callback)

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            startTime: 10,
            value: 0.4,
            hadRecentInput: false
          },
          {
            startTime: 60,
            value: 0.1,
            hadRecentInput: false
          }
        ]
      }
    })

    expect(callback.calls.count()).toBe(2)
    expect(callback.calls.mostRecent().args[0]).toEqual({
      value: 0.1,
      targetSelector: undefined,
      time: 10
    })
  })

  it('should start a new session window when the gap is exactly one second', () => {
    FakePerformanceObserver.supportedEntryTypes = ['layout-shift']
    const callback = jasmine.createSpy('callback')

    trackCumulativeLayoutShift({}, 0, callback)

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            startTime: 10,
            value: 0.3,
            hadRecentInput: false
          },
          {
            startTime: 1010,
            value: 0.1,
            hadRecentInput: false
          }
        ]
      }
    })

    expect(callback.calls.count()).toBe(2)
    expect(callback.calls.mostRecent().args[0]).toEqual({
      value: 0.3,
      targetSelector: undefined,
      time: 10
    })
  })
})
