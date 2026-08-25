import { createLocationChangeObservable } from './locationChangeObservable'

describe('locationChangeObservable', () => {
  it('falls back to hashchange when the Navigation API is unavailable', () => {
    const originalNavigationDescriptor = Object.getOwnPropertyDescriptor(
      window,
      'navigation'
    )
    Object.defineProperty(window, 'navigation', {
      configurable: true,
      value: undefined
    })
    const location = { href: 'https://example.com/#old' }
    const observable = createLocationChangeObservable(location)
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    location.href = 'https://example.com/#new'
    window.dispatchEvent(new Event('hashchange'))

    expect(subscriber).toHaveBeenCalledWith({
      oldLocation: { href: 'https://example.com/#old' },
      newLocation: { href: 'https://example.com/#new' },
      navigationType: 'push'
    })

    subscription.unsubscribe()
    if (originalNavigationDescriptor) {
      Object.defineProperty(
        window,
        'navigation',
        originalNavigationDescriptor
      )
    } else {
      delete window.navigation
    }
  })

  it('should notify on hash changes when the location href changes', () => {
    const location = { href: 'https://example.com/#old' }
    const observable = createLocationChangeObservable(location)
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    location.href = 'https://example.com/#new'
    if (window.navigation) {
      const event = new Event('currententrychange')
      Object.defineProperty(event, 'navigationType', { value: 'push' })
      window.navigation.dispatchEvent(event)
    } else {
      window.dispatchEvent(new Event('hashchange'))
    }

    expect(subscriber).toHaveBeenCalledWith({
      oldLocation: { href: 'https://example.com/#old' },
      newLocation: { href: 'https://example.com/#new' },
      navigationType: 'push'
    })

    subscription.unsubscribe()
  })

  it('should notify on history changes only when href actually changes', () => {
    const location = { href: 'https://example.com/page-1' }
    const observable = createLocationChangeObservable(location)
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    history.pushState({}, '', '/unchanged')
    expect(subscriber).not.toHaveBeenCalled()

    location.href = 'https://example.com/page-2'
    history.replaceState({}, '', '/page-2')

    expect(subscriber).toHaveBeenCalledWith({
      oldLocation: { href: 'https://example.com/page-1' },
      newLocation: { href: 'https://example.com/page-2' },
      navigationType: 'replace'
    })

    subscription.unsubscribe()
  })

  it('reports traversals from popstate', () => {
    const location = { href: 'https://example.com/page-1' }
    const observable = createLocationChangeObservable(location)
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    location.href = 'https://example.com/page-2'
    window.dispatchEvent(new Event('popstate'))

    expect(subscriber).toHaveBeenCalledWith({
      oldLocation: { href: 'https://example.com/page-1' },
      newLocation: { href: 'https://example.com/page-2' },
      navigationType: 'traverse'
    })

    subscription.unsubscribe()
  })

  it('reports same-document Navigation API changes', () => {
    if (!window.navigation) {
      pending('Navigation API is unavailable')
    }
    const location = { href: 'https://example.com/page-1' }
    const observable = createLocationChangeObservable(location)
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)
    const event = new Event('currententrychange')
    Object.defineProperty(event, 'navigationType', { value: 'replace' })

    location.href = 'https://example.com/page-2'
    window.navigation.dispatchEvent(event)

    expect(subscriber).toHaveBeenCalledWith({
      oldLocation: { href: 'https://example.com/page-1' },
      newLocation: { href: 'https://example.com/page-2' },
      navigationType: 'replace'
    })

    subscription.unsubscribe()
  })
})
