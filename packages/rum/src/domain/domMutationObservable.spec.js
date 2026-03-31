import {
  createDOMMutationObservable,
  getMutationObserverConstructor
} from './domMutationObservable'

describe('domMutationObservable', () => {
  let OriginalMutationObserver
  let originalZone

  beforeEach(() => {
    OriginalMutationObserver = window.MutationObserver
    originalZone = window.Zone
  })

  afterEach(() => {
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: OriginalMutationObserver
    })
    if (typeof originalZone === 'undefined') {
      delete window.Zone
    } else {
      window.Zone = originalZone
    }
  })

  it('should fallback to the window MutationObserver constructor', () => {
    function FakeMutationObserver() {}

    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: FakeMutationObserver
    })

    expect(getMutationObserverConstructor()).toBe(FakeMutationObserver)
  })

  it('should notify subscribers and disconnect on stop', () => {
    const disconnect = jasmine.createSpy('disconnect')
    let mutationCallback

    function FakeMutationObserver(callback) {
      mutationCallback = callback
      this.observe = jasmine.createSpy('observe')
      this.disconnect = disconnect
    }

    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: FakeMutationObserver
    })

    const observable = createDOMMutationObservable()
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    mutationCallback([{ type: 'childList' }])

    expect(subscriber).toHaveBeenCalled()

    subscription.unsubscribe()

    expect(disconnect).toHaveBeenCalled()
  })

  it('should be inert when MutationObserver is unavailable', () => {
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: undefined
    })

    const observable = createDOMMutationObservable()
    const subscriber = jasmine.createSpy('subscriber')
    const subscription = observable.subscribe(subscriber)

    expect(subscriber).not.toHaveBeenCalled()
    expect(() => subscription.unsubscribe()).not.toThrow()
  })
})
