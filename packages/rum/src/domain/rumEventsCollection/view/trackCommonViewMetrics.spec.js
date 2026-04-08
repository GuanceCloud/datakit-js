import {
  LifeCycle,
  Observable,
  ViewLoadingType
} from '@cloudcare/browser-core'
import { PAGE_ACTIVITY_END_DELAY } from '../../waitPageActivityEnd'
import { trackCommonViewMetrics } from './trackCommonViewMetrics'
import { THROTTLE_SCROLL_DURATION } from './trackScrollMetrics'

describe('trackCommonViewMetrics', () => {
  let OriginalPerformanceObserver
  let OriginalPerformanceEventTiming
  let OriginalResizeObserver
  let originalVisibilityState
  let originalPrerendering
  let originalInteractionCountDescriptor
  let originalScrollYDescriptor
  let originalInnerHeightDescriptor
  let originalScrollHeightDescriptor
  let interactionCount

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((options) => {
        this.type = options.type || options.entryTypes[0]
      })
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }
  }

  class FakeResizeObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe')
      this.unobserve = jasmine.createSpy('unobserve')
      FakeResizeObserver.instance = this
    }
  }

  function getObserver(type) {
    return FakePerformanceObserver.instances.find((instance) => instance.type === type)
  }

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-04-03T00:00:00.000Z'))
    OriginalPerformanceObserver = window.PerformanceObserver
    OriginalPerformanceEventTiming = window.PerformanceEventTiming
    OriginalResizeObserver = window.ResizeObserver
    originalVisibilityState = document.visibilityState
    originalPrerendering = document.prerendering
    originalInteractionCountDescriptor = Object.getOwnPropertyDescriptor(
      performance,
      'interactionCount'
    )
    originalScrollYDescriptor = Object.getOwnPropertyDescriptor(window, 'scrollY')
    originalInnerHeightDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'innerHeight'
    )
    originalScrollHeightDescriptor = Object.getOwnPropertyDescriptor(
      document.documentElement,
      'scrollHeight'
    )
    interactionCount = 0
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.supportedEntryTypes = [
      'layout-shift',
      'first-input',
      'event'
    ]
    FakeResizeObserver.instance = undefined

    function FakePerformanceEventTiming() {}
    FakePerformanceEventTiming.prototype.interactionId = 0

    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    window.PerformanceEventTiming = FakePerformanceEventTiming
    globalThis.PerformanceEventTiming = FakePerformanceEventTiming
    window.ResizeObserver = FakeResizeObserver
    globalThis.ResizeObserver = FakeResizeObserver

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: false
    })
    Object.defineProperty(performance, 'interactionCount', {
      configurable: true,
      get() {
        return interactionCount
      }
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 150
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 600
    })
    Object.defineProperty(document.documentElement, 'scrollHeight', {
      configurable: true,
      value: 1200
    })
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
    window.PerformanceEventTiming = OriginalPerformanceEventTiming
    globalThis.PerformanceEventTiming = OriginalPerformanceEventTiming
    window.ResizeObserver = OriginalResizeObserver
    globalThis.ResizeObserver = OriginalResizeObserver
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: originalPrerendering
    })
    if (originalInteractionCountDescriptor) {
      Object.defineProperty(
        performance,
        'interactionCount',
        originalInteractionCountDescriptor
      )
    } else {
      delete performance.interactionCount
    }
    if (originalScrollYDescriptor) {
      Object.defineProperty(window, 'scrollY', originalScrollYDescriptor)
    } else {
      delete window.scrollY
    }
    if (originalInnerHeightDescriptor) {
      Object.defineProperty(window, 'innerHeight', originalInnerHeightDescriptor)
    } else {
      delete window.innerHeight
    }
    if (originalScrollHeightDescriptor) {
      Object.defineProperty(
        document.documentElement,
        'scrollHeight',
        originalScrollHeightDescriptor
      )
    }
  })

  it('should aggregate loading, scroll, cls and inp metrics', () => {
    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const scheduleViewUpdate = jasmine.createSpy('scheduleViewUpdate')
    const tracking = trackCommonViewMetrics(
      lifeCycle,
      domMutationObservable,
      { excludedActivityUrls: [] },
      scheduleViewUpdate,
      ViewLoadingType.INITIAL_LOAD,
      { relative: 0, timeStamp: Date.now() }
    )
    const button = document.createElement('button')
    button.id = 'buy-now'
    document.body.appendChild(button)

    jasmine.clock().tick(25)
    domMutationObservable.notify()
    tracking.setLoadEvent(10)
    jasmine.clock().tick(PAGE_ACTIVITY_END_DELAY)

    FakeResizeObserver.instance.callback()
    jasmine.clock().tick(THROTTLE_SCROLL_DURATION)

    getObserver('layout-shift').callback({
      getEntries() {
        return [
          {
            entryType: 'layout-shift',
            startTime: 40,
            value: 0.1254,
            hadRecentInput: false,
            sources: [{ node: button }]
          }
        ]
      }
    })

    interactionCount = 1
    getObserver('event').callback({
      getEntries() {
        return [
          {
            interactionId: 7,
            startTime: 60,
            duration: 80,
            target: button
          }
        ]
      }
    })

    expect(scheduleViewUpdate.calls.count()).toBe(3)
    const metrics = tracking.getCommonViewMetrics()

    expect(metrics).toEqual(
      jasmine.objectContaining({
        loadingTime: 25,
        cumulativeLayoutShift: {
          value: 0.1254,
          targetSelector: '#buy-now',
          time: 40
        },
        interactionToNextPaint: {
          value: 80,
          targetSelector: '#buy-now',
          time: 60
        }
      })
    )
    expect(metrics.scroll.maxDepth).toBeGreaterThan(0)
    expect(metrics.scroll.maxDepth).toBeLessThanOrEqual(
      metrics.scroll.maxScrollHeight
    )
    expect(metrics.scroll.maxScrollHeight).toBeGreaterThan(0)
    expect(metrics.scroll.maxScrollHeightTime).toBeGreaterThanOrEqual(0)

    tracking.stopINPTracking()
    tracking.stop()

    expect(getObserver('event').disconnect).toHaveBeenCalled()
    expect(getObserver('first-input').disconnect).toHaveBeenCalled()
    expect(getObserver('layout-shift').disconnect).toHaveBeenCalled()
    expect(FakeResizeObserver.instance.unobserve).toHaveBeenCalled()

    button.remove()
  })
})
