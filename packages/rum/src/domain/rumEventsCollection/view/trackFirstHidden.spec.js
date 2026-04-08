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

  it('should update the timestamp on visibilitychange when the page becomes hidden', () => {
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
    const event = new Event('visibilitychange')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 64
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })

    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(64)
  })

  it('should ignore visibilitychange events while the page is still visible', () => {
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
    const event = new Event('visibilitychange')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 70
    })

    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(Infinity)
  })

  it('should ignore performance entries when prerendering and use event listeners instead', () => {
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
      value: true
    })
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([{ name: 'hidden', startTime: 25 }])

    const eventTarget = new EventTarget()
    const firstHidden = trackFirstHidden({ relative: 20 }, eventTarget)
    const event = new Event('prerenderingchange')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 84
    })
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })

    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(84)
    expect(performance.getEntriesByType).not.toHaveBeenCalled()
  })

  it('should ignore hidden visibility-state entries before the view start and stop listening', () => {
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
      .and.returnValue([{ name: 'hidden', startTime: 15 }])

    const eventTarget = new EventTarget()
    const firstHidden = trackFirstHidden({ relative: 20 }, eventTarget)

    firstHidden.stop()
    const event = new Event('pagehide')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 99
    })
    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(Infinity)
  })

  it('should fall back to event listeners when supported visibility entries have no usable hidden entry', () => {
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
      .and.returnValue([{ name: 'visible', startTime: 15 }])

    const eventTarget = new EventTarget()
    const firstHidden = trackFirstHidden({ relative: 20 }, eventTarget)
    const event = new Event('pagehide')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 88
    })

    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(88)
  })

  it('should not short-circuit to 0 when the document is hidden but still prerendering', () => {
    class FakePerformanceObserver {}
    FakePerformanceObserver.supportedEntryTypes = []
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'hidden'
    })
    Object.defineProperty(document, 'prerendering', {
      configurable: true,
      value: true
    })

    const eventTarget = new EventTarget()
    const firstHidden = trackFirstHidden({ relative: 10 }, eventTarget)
    const event = new Event('pagehide')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 77
    })

    expect(firstHidden.getTimeStamp()).toBe(Infinity)

    eventTarget.dispatchEvent(event)

    expect(firstHidden.getTimeStamp()).toBe(77)
  })

  it('should keep the first hidden timestamp after listeners are stopped', () => {
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
    const firstEvent = new Event('pagehide')
    Object.defineProperty(firstEvent, 'timeStamp', {
      configurable: true,
      value: 45
    })

    eventTarget.dispatchEvent(firstEvent)

    const secondEvent = new Event('pagehide')
    Object.defineProperty(secondEvent, 'timeStamp', {
      configurable: true,
      value: 90
    })
    eventTarget.dispatchEvent(secondEvent)

    expect(firstHidden.getTimeStamp()).toBe(45)
  })
})
