import { trackFirstHidden } from './trackFirstHidden'

describe('trackFirstHidden', () => {
  let originalVisibilityState
  let originalPrerendering
  let originalGetEntriesByType
  let OriginalPerformanceObserver

  beforeEach(() => {
    originalVisibilityState = document.visibilityState
    originalPrerendering = document.prerendering
    originalGetEntriesByType = performance.getEntriesByType
    OriginalPerformanceObserver = window.PerformanceObserver
  })

  afterEach(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: originalPrerendering
    })
    performance.getEntriesByType = originalGetEntriesByType
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should return 0 when the page is already hidden', () => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: false
    })

    const firstHidden = trackFirstHidden({ relative: 10 })

    expect(firstHidden.getTimeStamp()).toBe(0)
  })

  it('should use performance visibility-state entries when supported', () => {
    class FakePerformanceObserver {}
    FakePerformanceObserver.supportedEntryTypes = ['visibility-state']
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: false
    })
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([
        { name: 'visible', startTime: 10 },
        { name: 'hidden', startTime: 25 }
      ])

    const firstHidden = trackFirstHidden({ relative: 20 })

    expect(firstHidden.getTimeStamp()).toBe(25)
  })

  it('should listen to pagehide and visibility changes otherwise', () => {
    class FakePerformanceObserver {}
    FakePerformanceObserver.supportedEntryTypes = []
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: false
    })

    const eventTarget = new EventTarget()
    const firstHidden = trackFirstHidden({ relative: 0 }, eventTarget)
    const event = new Event('pagehide')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 42
    })

    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(42)
  })
})
