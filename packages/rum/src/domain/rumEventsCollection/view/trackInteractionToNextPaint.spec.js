import { ViewLoadingType } from '@cloudcare/browser-core'
import { interactionSelectorCache, updateInteractionSelector } from '../actions/interactionSelectorCache'
import {
  isInteractionToNextPaintSupported,
  MAX_INP_VALUE,
  trackInteractionToNextPaint,
  trackViewInteractionCount
} from './trackInteractionToNextPaint'

describe('trackInteractionToNextPaint', () => {
  let OriginalPerformanceObserver
  let OriginalPerformanceEventTiming
  let originalInteractionCountDescriptor

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((options) => {
        FakePerformanceObserver.observed.push(options)
      })
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }
  }

  FakePerformanceObserver.instances = []
  FakePerformanceObserver.observed = []
  FakePerformanceObserver.supportedEntryTypes = []

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    OriginalPerformanceEventTiming = window.PerformanceEventTiming
    originalInteractionCountDescriptor = Object.getOwnPropertyDescriptor(
      performance,
      'interactionCount'
    )
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.observed = []
    interactionSelectorCache.clear()
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
    window.PerformanceEventTiming = OriginalPerformanceEventTiming
    globalThis.PerformanceEventTiming = OriginalPerformanceEventTiming
    if (originalInteractionCountDescriptor) {
      Object.defineProperty(
        performance,
        'interactionCount',
        originalInteractionCountDescriptor
      )
    } else {
      delete performance.interactionCount
    }
    interactionSelectorCache.clear()
  })

  it('should detect whether INP is supported', () => {
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    FakePerformanceObserver.supportedEntryTypes = ['event']
    delete window.PerformanceEventTiming
    delete globalThis.PerformanceEventTiming

    expect(Boolean(isInteractionToNextPaintSupported())).toBeFalse()

    function FakePerformanceEventTiming() {}
    FakePerformanceEventTiming.prototype.interactionId = 0
    window.PerformanceEventTiming = FakePerformanceEventTiming
    globalThis.PerformanceEventTiming = FakePerformanceEventTiming

    expect(isInteractionToNextPaintSupported()).toBeTrue()
  })

  it('should compute and freeze view interaction counts from the native counter', () => {
    let interactionCount = 2
    Object.defineProperty(performance, 'interactionCount', {
      configurable: true,
      get() {
        return interactionCount
      }
    })

    const counter = trackViewInteractionCount(ViewLoadingType.ROUTE_CHANGE)

    interactionCount = 5
    expect(counter.getViewInteractionCount()).toBe(3)

    counter.stopViewInteractionCount()
    interactionCount = 9

    expect(counter.getViewInteractionCount()).toBe(3)
  })

  it('should expose noop behavior when INP is unsupported', () => {
    window.PerformanceObserver = undefined
    globalThis.PerformanceObserver = undefined
    delete window.PerformanceEventTiming
    delete globalThis.PerformanceEventTiming

    const tracking = trackInteractionToNextPaint({}, 10, ViewLoadingType.INITIAL_LOAD)

    expect(tracking.getInteractionToNextPaint()).toBeUndefined()
    expect(() => tracking.setViewEnd(20)).not.toThrow()
    expect(() => tracking.stop()).not.toThrow()
  })

  it('should collect the worst interaction and reuse cached selectors', () => {
    let interactionCount = 1
    Object.defineProperty(performance, 'interactionCount', {
      configurable: true,
      get() {
        return interactionCount
      }
    })

    function FakePerformanceEventTiming() {}
    FakePerformanceEventTiming.prototype.interactionId = 0
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    window.PerformanceEventTiming = FakePerformanceEventTiming
    globalThis.PerformanceEventTiming = FakePerformanceEventTiming
    FakePerformanceObserver.supportedEntryTypes = ['event', 'first-input']

    const tracking = trackInteractionToNextPaint(
      {},
      10,
      ViewLoadingType.INITIAL_LOAD
    )

    updateInteractionSelector(20, '.cta-button')
    FakePerformanceObserver.instances[1].callback({
      getEntries() {
        return [
          {
            interactionId: 7,
            startTime: 20,
            duration: MAX_INP_VALUE + 100,
            target: null
          }
        ]
      }
    })

    expect(tracking.getInteractionToNextPaint()).toEqual({
      value: MAX_INP_VALUE,
      targetSelector: '.cta-button',
      time: 10
    })

    tracking.stop()

    expect(
      FakePerformanceObserver.instances.map((instance) => instance.disconnect.calls.count())
    ).toEqual([1, 1])
  })
})
