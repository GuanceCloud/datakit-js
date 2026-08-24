import {
  LifeCycle,
  LifeCycleEventType,
  Observable,
  PageExitReason
} from '@cloudcare/browser-core'
import { trackViews, THROTTLE_VIEW_UPDATE_PERIOD } from './trackViews'

describe('trackViews', () => {
  let OriginalPerformanceObserver
  let originalVisibilityState
  let originalPrerendering
  let originalBridge
  let originalHasFocus

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-04-01T00:00:00.000Z'))
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = undefined
    globalThis.PerformanceObserver = undefined
    originalVisibilityState = document.visibilityState
    originalPrerendering = document.prerendering
    originalBridge = window.FTWebViewJavascriptBridge
    originalHasFocus = document.hasFocus
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
    jasmine.clock().uninstall()
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
    window.FTWebViewJavascriptBridge = originalBridge
    document.hasFocus = originalHasFocus
  })

  it('should start a manual route-change view and publish sanitized custom timings', () => {
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const updatedEvents = []
    const createdEvents = []

    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/products',
        hash: '#top',
        href: 'https://example.com/products#top'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      false,
      {
        name: 'Products',
        service: 'shop-ui',
        version: '1.0.0',
        context: { plan: 'free' }
      }
    )

    tracking.setViewContextProperty('tier', 'gold')
    expect(tracking.getViewContext()).toEqual({
      plan: 'free',
      tier: 'gold'
    })

    tracking.startView(
      {
        name: 'Checkout',
        service: 'checkout-ui',
        version: '2.0.0',
        context: { cart: 'full' }
      },
      { relative: 100, timeStamp: 1000 }
    )
    tracking.setViewName('Checkout Review')
    tracking.addTiming('ready state', 1300)
    jasmine.clock().tick(THROTTLE_VIEW_UPDATE_PERIOD)

    const routeChangeUpdate = updatedEvents.find((event) => {
      return (
        event.loadingType === 'route_change' &&
        event.name === 'Checkout Review' &&
        event.service === 'checkout-ui'
      )
    })

    expect(createdEvents.length).toBe(2)
    expect(routeChangeUpdate).toEqual(
      jasmine.objectContaining({
        loadingType: 'route_change',
        name: 'Checkout Review',
        service: 'checkout-ui',
        version: '2.0.0',
        context: { cart: 'full' },
        customTimings: jasmine.objectContaining({
          ready_state: 1300
        })
      })
    )

    tracking.stop()
  })

  it('should ignore anchor-only hash changes and renew on route hash changes', () => {
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const createdEvents = []
    const endedEvents = []
    const topAnchor = document.createElement('div')
    topAnchor.id = 'top'
    const detailsAnchor = document.createElement('div')
    detailsAnchor.id = 'details'
    document.body.appendChild(topAnchor)
    document.body.appendChild(detailsAnchor)

    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_ENDED, (event) => {
      endedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/products',
        hash: '#top',
        href: 'https://example.com/products#top'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      true
    )

    locationChangeObservable.notify({
      oldLocation: {
        pathname: '/products',
        hash: '#top'
      },
      newLocation: {
        pathname: '/products',
        hash: '#details'
      }
    })

    expect(createdEvents.length).toBe(1)
    expect(endedEvents.length).toBe(0)

    locationChangeObservable.notify({
      oldLocation: {
        pathname: '/products',
        hash: '#top'
      },
      newLocation: {
        pathname: '/products',
        hash: '#/checkout'
      }
    })

    expect(createdEvents.length).toBe(2)
    expect(endedEvents.length).toBe(1)

    tracking.stop()
    topAnchor.remove()
    detailsAnchor.remove()
  })

  it('should use an explicit URL for a manually started view', () => {
    const lifeCycle = new LifeCycle()
    const createdEvents = []
    const updatedEvents = []
    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/old',
        hash: '',
        href: 'https://example.com/old'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      new Observable(),
      false
    )

    tracking.startView({
      name: '/products/[id]',
      url: '/products/42?tab=details#reviews'
    })

    const routeChangeView = createdEvents.find((event) => {
      return event.name === '/products/[id]'
    })
    expect(routeChangeView.url).toBe('/products/42?tab=details#reviews')

    const routeChangeUpdate = updatedEvents.find((event) => {
      return event.id === routeChangeView.id
    })
    expect(routeChangeUpdate.location).toEqual(
      jasmine.objectContaining({
        href: 'https://example.com/old',
        pathname: '/old'
      })
    )

    tracking.stop()
  })

  it('should preserve metadata and context when the session is renewed', () => {
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const createdEvents = []
    const updatedEvents = []

    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/checkout',
        hash: '',
        href: 'https://example.com/checkout'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      false,
      {
        name: 'Checkout',
        service: 'checkout-ui',
        version: '3.0.0',
        context: { plan: 'pro' }
      }
    )

    tracking.setViewContextProperty('tier', 'gold')
    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)
    jasmine.clock().tick(THROTTLE_VIEW_UPDATE_PERIOD)

    expect(createdEvents.length).toBe(2)
    expect(createdEvents[1]).toEqual(
      jasmine.objectContaining({
        name: 'Checkout',
        service: 'checkout-ui',
        version: '3.0.0'
      })
    )
    expect(tracking.getViewContext()).toEqual({
      plan: 'pro',
      tier: 'gold'
    })

    const renewedViewUpdate = updatedEvents.find((event) => {
      return (
        event.loadingType === 'route_change' &&
        event.name === 'Checkout' &&
        event.service === 'checkout-ui'
      )
    })
    expect(renewedViewUpdate).toEqual(
      jasmine.objectContaining({
        loadingType: 'route_change',
        name: 'Checkout',
        service: 'checkout-ui',
        version: '3.0.0',
        context: {
          plan: 'pro',
          tier: 'gold'
        }
      })
    )

    tracking.stop()
  })

  it('should mark the current view as inactive when the session expires', () => {
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const endedEvents = []
    const updatedEvents = []

    lifeCycle.subscribe(LifeCycleEventType.VIEW_ENDED, (event) => {
      endedEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/checkout',
        hash: '',
        href: 'https://example.com/checkout'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      false
    )

    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)

    expect(endedEvents.length).toBe(1)
    expect(updatedEvents[updatedEvents.length - 1]).toEqual(
      jasmine.objectContaining({
        isActive: false,
        sessionIsActive: false
      })
    )

    tracking.stop()
  })

  it('should end and renew bridged WebView views across lifecycle changes', () => {
    window.FTWebViewJavascriptBridge = {}
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(true)
    const lifeCycle = new LifeCycle()
    const createdEvents = []
    const endedEvents = []
    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_ENDED, (event) => {
      endedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/flash-news',
        hash: '',
        href: 'https://example.com/flash-news'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      new Observable(),
      false,
      { name: '/flash-news', context: { source: 'webview' } }
    )

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('blur'))

    expect(endedEvents.length).toBe(1)

    window.dispatchEvent(new Event('focus'))
    window.dispatchEvent(new Event('focus'))

    expect(createdEvents.length).toBe(2)
    expect(createdEvents[1]).toEqual(
      jasmine.objectContaining({
        name: '/flash-news'
      })
    )
    expect(tracking.getViewContext()).toEqual({ source: 'webview' })

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    window.dispatchEvent(new Event('visibilitychange'))
    expect(endedEvents.length).toBe(2)

    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    window.dispatchEvent(new Event('resume'))
    expect(createdEvents.length).toBe(3)

    tracking.stop()
    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    expect(createdEvents.length).toBe(3)
  })

  it('should end an initially unfocused bridged WebView', () => {
    window.FTWebViewJavascriptBridge = {}
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(false)
    const lifeCycle = new LifeCycle()
    const updatedEvents = []
    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/flash-news',
        hash: '',
        href: 'https://example.com/flash-news'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      new Observable(),
      false
    )

    expect(updatedEvents[updatedEvents.length - 1]).toEqual(
      jasmine.objectContaining({
        isActive: false,
        sessionIsActive: false
      })
    )

    tracking.stop()
  })

  it('should immediately end views created while a bridged WebView is inactive', () => {
    window.FTWebViewJavascriptBridge = {}
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(true)
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const createdEvents = []
    const updatedEvents = []
    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })
    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/flash-news',
        hash: '',
        href: 'https://example.com/flash-news'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      true
    )

    window.dispatchEvent(new Event('blur'))
    locationChangeObservable.notify({
      oldLocation: { pathname: '/flash-news', hash: '' },
      newLocation: { pathname: '/detail', hash: '' }
    })

    expect(createdEvents.length).toBe(2)
    expect(updatedEvents[updatedEvents.length - 1]).toEqual(
      jasmine.objectContaining({
        duration: 0,
        isActive: false,
        sessionIsActive: false
      })
    )

    jasmine.clock().tick(24 * 60 * 60 * 1000)
    expect(updatedEvents[updatedEvents.length - 1].duration).toBe(0)

    window.dispatchEvent(new Event('focus'))
    expect(createdEvents.length).toBe(3)

    tracking.stop()
  })

  it('should ignore focus changes outside bridged WebViews', () => {
    window.FTWebViewJavascriptBridge = undefined
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(false)
    const lifeCycle = new LifeCycle()
    const createdSpy = jasmine.createSpy('created')
    const endedSpy = jasmine.createSpy('ended')
    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, createdSpy)
    lifeCycle.subscribe(LifeCycleEventType.VIEW_ENDED, endedSpy)

    const tracking = trackViews(
      {
        pathname: '/flash-news',
        hash: '',
        href: 'https://example.com/flash-news'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      new Observable(),
      false
    )

    window.dispatchEvent(new Event('blur'))
    window.dispatchEvent(new Event('focus'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    window.dispatchEvent(new Event('visibilitychange'))
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    window.dispatchEvent(new Event('resume'))

    expect(createdSpy).toHaveBeenCalledTimes(1)
    expect(endedSpy).not.toHaveBeenCalled()
    expect(document.hasFocus).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should stop renewing views on location changes after stop is called', () => {
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const createdEvents = []

    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, (event) => {
      createdEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/products',
        hash: '',
        href: 'https://example.com/products'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      true
    )

    expect(createdEvents.length).toBe(1)

    tracking.stop()
    locationChangeObservable.notify({
      oldLocation: {
        pathname: '/products',
        hash: ''
      },
      newLocation: {
        pathname: '/checkout',
        hash: ''
      }
    })

    expect(createdEvents.length).toBe(1)
  })

  it('should add native soft navigation metrics to the matching route view', () => {
    class FakePerformanceObserver {
      constructor(callback) {
        this.callback = callback
        this.observe = jasmine.createSpy('observe')
        this.disconnect = jasmine.createSpy('disconnect')
        FakePerformanceObserver.instances.push(this)
      }
    }
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.supportedEntryTypes = [
      'soft-navigation',
      'interaction-contentful-paint'
    ]
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver

    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const updatedEvents = []
    const location = {
      pathname: '/products',
      hash: '',
      href: 'https://example.com/products'
    }
    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      location,
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      locationChangeObservable,
      true
    )
    location.pathname = '/checkout'
    location.href = 'https://example.com/checkout'
    locationChangeObservable.notify({
      oldLocation: { pathname: '/products', hash: '' },
      newLocation: { pathname: '/checkout', hash: '' }
    })

    const softNavigationObserver = FakePerformanceObserver.instances.find(
      (observer) =>
        observer.observe.calls
          .allArgs()
          .some((args) => args[0].type === 'soft-navigation')
    )
    softNavigationObserver.callback({
      getEntries: () => [
        {
          entryType: 'soft-navigation',
          name: 'https://example.com/unrelated',
          startTime: 0,
          duration: 10,
          interactionId: 6,
          navigationType: 'replace'
        }
      ]
    })
    jasmine.clock().tick(THROTTLE_VIEW_UPDATE_PERIOD)
    expect(
      updatedEvents
        .filter((event) => event.loadingType === 'route_change')
        .pop().navigationType
    ).toBeUndefined()

    softNavigationObserver.callback({
      getEntries: () => [
        {
          entryType: 'soft-navigation',
          name: 'https://example.com/checkout',
          startTime: 0,
          duration: 20,
          interactionId: 7,
          navigationType: 'push',
          getLargestInteractionContentfulPaint: () => ({
            startTime: 0,
            largestContentfulPaint: { renderTime: 50 }
          })
        }
      ]
    })
    softNavigationObserver.callback({
      getEntries: () => [
        {
          entryType: 'interaction-contentful-paint',
          startTime: 0,
          interactionId: 8,
          largestContentfulPaint: { renderTime: 70 }
        },
        {
          entryType: 'interaction-contentful-paint',
          startTime: 0,
          interactionId: 7,
          largestContentfulPaint: { renderTime: 80 }
        }
      ]
    })
    jasmine.clock().tick(THROTTLE_VIEW_UPDATE_PERIOD)

    const routeChangeUpdate = updatedEvents
      .filter((event) => event.loadingType === 'route_change')
      .pop()
    expect(routeChangeUpdate.navigationType).toBe('push')
    expect(routeChangeUpdate.initialViewMetrics).toEqual(
      jasmine.objectContaining({
        firstContentfulPaint: 20,
        largestContentfulPaint: {
          value: 80,
          targetSelector: undefined
        }
      })
    )

    tracking.stop()
    expect(softNavigationObserver.disconnect).toHaveBeenCalled()
  })

  it('should replace the whole view context and publish it on the next update', () => {
    const lifeCycle = new LifeCycle()
    const updatedEvents = []

    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/products',
        hash: '',
        href: 'https://example.com/products'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      new Observable(),
      false,
      {
        context: { plan: 'free', tier: 'silver' }
      }
    )

    tracking.setViewContext({ plan: 'pro' })
    jasmine.clock().tick(THROTTLE_VIEW_UPDATE_PERIOD)

    expect(tracking.getViewContext()).toEqual({ plan: 'pro' })
    expect(updatedEvents[updatedEvents.length - 1]).toEqual(
      jasmine.objectContaining({
        context: { plan: 'pro' }
      })
    )

    tracking.stop()
  })

  it('should flush a view update immediately when the page exits because of unloading', () => {
    const lifeCycle = new LifeCycle()
    const updatedEvents = []

    lifeCycle.subscribe(LifeCycleEventType.VIEW_UPDATED, (event) => {
      updatedEvents.push(event)
    })

    const tracking = trackViews(
      {
        pathname: '/checkout',
        hash: '',
        href: 'https://example.com/checkout'
      },
      lifeCycle,
      new Observable(),
      { excludedActivityUrls: [] },
      new Observable(),
      false
    )

    const updatesBeforeExit = updatedEvents.length

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })

    expect(updatedEvents.length).toBe(updatesBeforeExit + 1)
    expect(updatedEvents[updatedEvents.length - 1]).toEqual(
      jasmine.objectContaining({
        isActive: true,
        location: jasmine.objectContaining({
          pathname: '/checkout'
        })
      })
    )

    tracking.stop()
  })
})
