import { createLocationChangeObservable } from './locationChangeObservable'

describe('locationChangeObservable', () => {
  it('should notify on hash changes when the location href changes', () => {
    const location = { href: 'https://example.com/#old' }
    const observable = createLocationChangeObservable(location)
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    location.href = 'https://example.com/#new'
    window.dispatchEvent(new Event('hashchange'))

    expect(subscriber).toHaveBeenCalledWith({
      oldLocation: { href: 'https://example.com/#old' },
      newLocation: { href: 'https://example.com/#new' }
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
      newLocation: { href: 'https://example.com/page-2' }
    })

    subscription.unsubscribe()
  })
})
