import { Observable } from '@cloudcare/browser-core'
import {
  createPageActivityObservable,
  doWaitPageActivityEnd,
  PAGE_ACTIVITY_END_DELAY,
  PAGE_ACTIVITY_VALIDATION_DELAY
} from './waitPageActivityEnd'

describe('waitPageActivityEnd', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should complete with no activity after the validation delay', () => {
    const callback = jasmine.createSpy('callback')
    const pageActivityObservable = new Observable()

    doWaitPageActivityEnd(pageActivityObservable, callback)

    jasmine.clock().tick(PAGE_ACTIVITY_VALIDATION_DELAY)

    expect(callback).toHaveBeenCalledWith({ hadActivity: false })
  })

  it('should wait for the end delay after activity becomes idle', () => {
    const callback = jasmine.createSpy('callback')
    const pageActivityObservable = new Observable()

    doWaitPageActivityEnd(pageActivityObservable, callback)

    pageActivityObservable.notify({ isBusy: true })
    jasmine.clock().tick(PAGE_ACTIVITY_VALIDATION_DELAY)
    expect(callback).not.toHaveBeenCalled()

    pageActivityObservable.notify({ isBusy: false })
    jasmine.clock().tick(PAGE_ACTIVITY_END_DELAY - 1)
    expect(callback).not.toHaveBeenCalled()

    jasmine.clock().tick(1)
    expect(callback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        hadActivity: true,
        end: jasmine.any(Number)
      })
    )
  })

  it('should stop pending completion when stopped explicitly', () => {
    const callback = jasmine.createSpy('callback')
    const pageActivityObservable = new Observable()
    const waiter = doWaitPageActivityEnd(pageActivityObservable, callback, 500)

    pageActivityObservable.notify({ isBusy: false })
    waiter.stop()
    jasmine.clock().tick(1000)

    expect(callback).not.toHaveBeenCalled()
  })
})

describe('createPageActivityObservable', () => {
  let OriginalPerformanceObserver

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should emit busy/idle states for tracked requests and DOM mutations', () => {
    const lifeCycle = {
      callbacks: {},
      subscribe(eventType, callback) {
        this.callbacks[eventType] = callback
        return {
          unsubscribe() {}
        }
      }
    }
    const domMutationObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')

    const subscription = createPageActivityObservable(
      lifeCycle,
      domMutationObservable,
      {
        excludedActivityUrls: [/excluded/]
      }
    ).subscribe(subscriber)

    domMutationObservable.notify()
    expect(subscriber).toHaveBeenCalledWith({ isBusy: false })

    lifeCycle.callbacks.REQUEST_STARTED({
      url: 'https://example.com/request',
      requestIndex: 2
    })
    expect(subscriber.calls.mostRecent().args[0]).toEqual({ isBusy: true })

    lifeCycle.callbacks.REQUEST_COMPLETED({
      url: 'https://example.com/request',
      requestIndex: 2
    })
    expect(subscriber.calls.mostRecent().args[0]).toEqual({ isBusy: false })

    lifeCycle.callbacks.REQUEST_STARTED({
      url: 'https://example.com/excluded',
      requestIndex: 3
    })
    expect(subscriber.calls.mostRecent().args[0]).toEqual({ isBusy: false })

    subscription.unsubscribe()
  })
})
