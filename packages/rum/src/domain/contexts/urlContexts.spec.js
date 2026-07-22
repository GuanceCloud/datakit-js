import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startUrlContexts } from './urlContexts'

describe('urlContexts', () => {
  let originalReferrerDescriptor

  beforeEach(() => {
    originalReferrerDescriptor = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'referrer'
    )
    Object.defineProperty(document, 'referrer', {
      configurable: true,
      value: 'https://referrer.example/landing'
    })
  })

  afterEach(() => {
    if (originalReferrerDescriptor) {
      Object.defineProperty(
        Document.prototype,
        'referrer',
        originalReferrerDescriptor
      )
    }
  })

  it('should create a url context when a view starts and close it when the view ends', () => {
    const lifeCycle = new LifeCycle()
    const unsubscribe = jasmine.createSpy('unsubscribe')
    const locationChangeObservable = {
      subscribe() {
        return { unsubscribe }
      }
    }
    const location = {
      href: 'https://example.com/orders/42?step=1',
      pathname: '/orders/42',
      hash: '',
      host: 'example.com'
    }

    const urlContexts = startUrlContexts(
      lifeCycle,
      locationChangeObservable,
      location
    )

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      startClocks: { relative: 10 }
    })

    expect(urlContexts.findUrl(10)).toEqual({
      url: 'https://example.com/orders/42?step=1',
      referrer: 'https://referrer.example/landing',
      host: 'example.com',
      path: '/orders/42',
      pathGroup: '/orders/?',
      urlQuery: { step: '1' },
      pathname: '/orders/42'
    })

    lifeCycle.notify(LifeCycleEventType.AFTER_VIEW_ENDED, {
      endClocks: { relative: 20 }
    })

    expect(urlContexts.findUrl(25)).toBeUndefined()
    urlContexts.stop()
    expect(unsubscribe).toHaveBeenCalled()
  })

  it('should update the active url context on location changes and preserve the referrer', () => {
    const lifeCycle = new LifeCycle()
    let onLocationChange
    const location = {
      href: 'https://example.com/#/products?sku=1',
      pathname: '/',
      hash: '#/products?sku=1',
      host: 'example.com'
    }
    const locationChangeObservable = {
      subscribe(callback) {
        onLocationChange = callback
        return { unsubscribe() {} }
      }
    }

    const urlContexts = startUrlContexts(
      lifeCycle,
      locationChangeObservable,
      location
    )

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      startClocks: { relative: 5 }
    })

    const firstContext = urlContexts.findUrl(5)
    expect(firstContext.path).toBe('/#/products')

    onLocationChange({
      newLocation: {
        href: 'https://example.com/account/profile?id=9',
        pathname: '/account/profile',
        hash: '',
        host: 'example.com'
      }
    })

    const changedContext = urlContexts.findUrl()
    expect(changedContext).toEqual({
      url: 'https://example.com/account/profile?id=9',
      referrer: 'https://referrer.example/landing',
      host: 'example.com',
      path: '/account/profile',
      pathGroup: '/account/profile',
      urlQuery: { id: '9' },
      pathname: '/account/profile'
    })
  })

  it('should resolve an explicit view URL and use it as the next view referrer', () => {
    const lifeCycle = new LifeCycle()
    const location = {
      href: 'https://example.com/current',
      pathname: '/current',
      hash: '',
      host: 'example.com'
    }
    const urlContexts = startUrlContexts(
      lifeCycle,
      {
        subscribe() {
          return { unsubscribe() {} }
        }
      },
      location
    )

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      startClocks: { relative: 10 },
      url: '/products/42?tab=details#reviews'
    })

    expect(urlContexts.findUrl(10)).toEqual({
      url: 'https://example.com/products/42?tab=details#reviews',
      referrer: 'https://referrer.example/landing',
      host: 'example.com',
      path: '/products/42',
      pathGroup: '/products/?',
      urlQuery: { tab: 'details' },
      pathname: '/products/42'
    })

    lifeCycle.notify(LifeCycleEventType.AFTER_VIEW_ENDED, {
      endClocks: { relative: 20 }
    })
    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      startClocks: { relative: 30 },
      url: '/checkout'
    })

    expect(urlContexts.findUrl(30).referrer).toBe(
      'https://example.com/products/42?tab=details#reviews'
    )
  })
})
