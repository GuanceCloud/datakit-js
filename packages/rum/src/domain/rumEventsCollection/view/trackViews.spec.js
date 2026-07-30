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

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-04-01T00:00:00.000Z'))
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
