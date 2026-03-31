import { LifeCycle, Observable, ViewLoadingType } from '@cloudcare/browser-core'
import { trackLoadingTime } from './trackLoadingTime'
import { PAGE_ACTIVITY_END_DELAY } from '../../waitPageActivityEnd'

describe('trackLoadingTime', () => {
  let OriginalPerformanceObserver
  let originalVisibilityState
  let originalPrerendering

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-03-31T00:00:00.000Z'))
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

  it('should report the largest loading time candidate after activity and load event', () => {
    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const callback = jasmine.createSpy('callback')
    const tracking = trackLoadingTime(
      lifeCycle,
      domMutationObservable,
      { excludedActivityUrls: [] },
      ViewLoadingType.INITIAL_LOAD,
      { relative: 0, timeStamp: Date.now() },
      callback
    )

    jasmine.clock().tick(30)
    domMutationObservable.notify()
    tracking.setLoadEvent(20)
    jasmine.clock().tick(PAGE_ACTIVITY_END_DELAY)

    expect(callback).toHaveBeenCalledWith(30)

    tracking.stop()
  })

  it('should ignore loading times that happen after the first hidden timestamp', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })

    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const callback = jasmine.createSpy('callback')

    trackLoadingTime(
      lifeCycle,
      domMutationObservable,
      { excludedActivityUrls: [] },
      ViewLoadingType.ROUTE_CHANGE,
      { relative: 10, timeStamp: Date.now() },
      callback
    )

    jasmine.clock().tick(30)
    domMutationObservable.notify()
    jasmine.clock().tick(PAGE_ACTIVITY_END_DELAY)

    expect(callback).not.toHaveBeenCalled()
  })
})
