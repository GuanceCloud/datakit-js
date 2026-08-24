import {
  LifeCycle,
  LifeCycleEventType,
  Observable
} from '@cloudcare/browser-core'
import { startViewCollection } from './viewCollection'

describe('viewCollection', () => {
  let OriginalPerformanceObserver
  let originalVisibilityState
  let originalPrerendering

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = undefined
    globalThis.PerformanceObserver = undefined
    originalVisibilityState = document.visibilityState
    originalPrerendering = document.prerendering
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: false
    })
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: originalPrerendering
    })
  })

  it('should transform view updates into raw rum view events', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const collection = startViewCollection(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask',
        trackViewsManually: true,
        excludedActivityUrls: []
      },
      {
        href: 'https://example.com/products'
      },
      new Observable(),
      new Observable(),
      {
        findAll: () => [{ state: 'active', start: 0 }]
      },
      {
        getReplayStats: () => ({
          records_count: 2,
          segments_count: 1
        })
      }
    )

    lifeCycle.notify(LifeCycleEventType.VIEW_UPDATED, {
      id: 'view-1',
      name: 'Products',
      loadingType: 'initial_load',
      navigationType: 'push',
      isActive: true,
      sessionIsActive: true,
      documentVersion: 3,
      duration: 120,
      location: { href: 'https://example.com/products' },
      startClocks: {
        relative: 10,
        timeStamp: 20
      },
      eventCounts: {
        actionCount: 1,
        frustrationCount: 2,
        errorCount: 3,
        longTaskCount: 4,
        resourceCount: 5
      },
      commonViewMetrics: {
        loadingTime: 30,
        scroll: {
          maxDepth: 400,
          maxDepthScrollTop: 200,
          maxScrollHeight: 800,
          maxScrollHeightTime: 50
        },
        cumulativeLayoutShift: {
          value: 0.12,
          time: 40,
          targetSelector: 'DIV[data-testid="hero"]'
        },
        interactionToNextPaint: {
          value: 60,
          targetSelector: 'BUTTON[data-testid="buy"]'
        }
      },
      initialViewMetrics: {
        navigationTimings: {
          firstByte: 5,
          fetchStart: 1,
          responseEnd: 4,
          domComplete: 10,
          domContentLoaded: 8,
          domInteractive: 6,
          loadEvent: 12,
          loadEventEnd: 12,
          loadEventStart: 11,
          domContentLoadedEventEnd: 8
        },
        firstContentfulPaint: 15,
        firstInput: {
          delay: 6,
          time: 20,
          targetSelector: 'INPUT[name="email"]'
        },
        largestContentfulPaint: {
          value: 25,
          targetSelector: 'IMG[data-testid="poster"]'
        }
      },
      customTimings: {
        custom_ready: 33
      }
    })

    const event = collected.calls.mostRecent().args[0]

    expect(event.startTime).toBe(10)
    expect(event.domainContext.location).toEqual({
      href: 'https://example.com/products'
    })
    expect(event.rawRumEvent.type).toBe('view')
    expect(event.rawRumEvent.view.name).toBe('Products')
    expect(event.rawRumEvent.view.loading_type).toBe('initial_load')
    expect(event.rawRumEvent.view.navigation_type).toBe('push')
    expect(event.rawRumEvent.view.loading_time).toBe(30000000)
    expect(event.rawRumEvent.view.first_contentful_paint).toBe(15000000)
    expect(event.rawRumEvent.view.largest_contentful_paint).toBe(25000000)
    expect(event.rawRumEvent.view.first_input_delay).toBe(6000000)
    expect(event.rawRumEvent.view.resource.count).toBe(5)
    expect(event.rawRumEvent.display.scroll.max_depth).toBe(400)
    expect(event.rawRumEvent._gc.page_states).toEqual([
      { state: 'active', start: 0 }
    ])
    expect(event.rawRumEvent.privacy.replay_level).toBe('mask')
    expect(event.rawRumEvent.view.custom_timings.custom_ready).toBe(33000000)

    collection.stop()
  })

  it('should omit custom timings when empty and mark inactive sessions explicitly', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    const collection = startViewCollection(
      lifeCycle,
      {
        defaultPrivacyLevel: 'mask',
        trackViewsManually: true,
        excludedActivityUrls: []
      },
      {
        href: 'https://example.com/checkout'
      },
      new Observable(),
      new Observable(),
      {
        findAll: () => []
      },
      {
        getReplayStats: () => undefined
      }
    )

    lifeCycle.notify(LifeCycleEventType.VIEW_UPDATED, {
      id: 'view-2',
      name: 'Checkout',
      loadingType: 'route_change',
      isActive: false,
      sessionIsActive: false,
      documentVersion: 1,
      duration: 50,
      location: { href: 'https://example.com/checkout' },
      startClocks: {
        relative: 15,
        timeStamp: 30
      },
      eventCounts: {
        actionCount: 0,
        frustrationCount: 0,
        errorCount: 0,
        longTaskCount: 0,
        resourceCount: 0
      },
      commonViewMetrics: {
        loadingTime: 10
      },
      initialViewMetrics: {
        navigationTimings: {}
      },
      customTimings: {}
    })

    const event = collected.calls.mostRecent().args[0]

    expect(event.rawRumEvent.view.custom_timings).toBeUndefined()
    expect(event.rawRumEvent.session.is_active).toBeFalse()
    expect(event.rawRumEvent.session.has_replay).toBeUndefined()

    collection.stop()
  })
})
