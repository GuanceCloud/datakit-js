import {
  getInteractionCount,
  initInteractionCountPolyfill
} from './interactionCountPolyfill'

describe('interactionCountPolyfill', () => {
  let OriginalPerformanceObserver
  let originalPerformance

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe')
      FakePerformanceObserver.instance = this
    }
  }

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    originalPerformance = window.performance
    FakePerformanceObserver.instance = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
    Object.defineProperty(window, 'performance', {
      configurable: true,
      value: originalPerformance
    })
  })

  it('should estimate interaction counts from event interaction ids', () => {
    Object.defineProperty(window, 'performance', {
      configurable: true,
      value: {}
    })
    initInteractionCountPolyfill()

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [{ interactionId: 14 }, { interactionId: 28 }]
      }
    })

    expect(FakePerformanceObserver.instance.observe).toHaveBeenCalledWith({
      type: 'event',
      buffered: true,
      durationThreshold: 0
    })
    expect(getInteractionCount()).toBe(3)
  })
})
