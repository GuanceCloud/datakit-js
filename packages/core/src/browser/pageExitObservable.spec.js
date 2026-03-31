import {
  createPageExitObservable,
  isPageExitReason,
  PageExitReason
} from './pageExitObservable'

describe('pageExitObservable', () => {
  let originalVisibilityState

  beforeEach(() => {
    originalVisibilityState = document.visibilityState
  })

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState
    })
  })

  it('should notify when the document becomes hidden', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = createPageExitObservable()

    observable.subscribe(subscriber)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    window.dispatchEvent(new Event('visibilitychange'))

    expect(subscriber).toHaveBeenCalledWith({
      reason: PageExitReason.HIDDEN
    })
  })

  it('should notify on freeze events', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = createPageExitObservable()

    observable.subscribe(subscriber)
    window.dispatchEvent(new Event('freeze'))

    expect(subscriber).toHaveBeenCalledWith({
      reason: PageExitReason.FROZEN
    })
  })

  it('should stop notifying after unsubscribe', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = createPageExitObservable()
    const subscription = observable.subscribe(subscriber)

    subscription.unsubscribe()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    window.dispatchEvent(new Event('visibilitychange'))

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('should identify page exit reasons', () => {
    expect(isPageExitReason(PageExitReason.HIDDEN)).toBeTrue()
    expect(isPageExitReason('not-a-page-exit')).toBeFalse()
  })
})
