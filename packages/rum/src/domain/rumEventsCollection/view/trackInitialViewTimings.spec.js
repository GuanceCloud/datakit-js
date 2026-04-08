import { trackInitialViewMetrics } from './trackInitialViewTimings'

describe('trackInitialViewTimings', () => {
  let OriginalPerformanceObserver
  let originalVisibilityState
  let originalPrerendering
  let originalGetEntriesByType

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((options) => {
        this.type = options.type || options.entryTypes[0]
      })
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }
  }

  function getObserver(type) {
    return FakePerformanceObserver.instances.find((instance) => instance.type === type)
  }

  beforeEach(() => {
    jasmine.clock().install()
    OriginalPerformanceObserver = window.PerformanceObserver
    originalVisibilityState = document.visibilityState
    originalPrerendering = document.prerendering
    originalGetEntriesByType = performance.getEntriesByType
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.supportedEntryTypes = [
      'navigation',
      'paint',
      'largest-contentful-paint',
      'first-input'
    ]

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
      .and.callFake((type) => {
        if (type === 'navigation') {
          return [
            {
              fetchStart: 1,
              responseEnd: 10,
              domComplete: 20,
              domContentLoadedEventEnd: 30,
              domContentLoadedEventStart: 25,
              domInteractive: 15,
              loadEventEnd: 40,
              loadEventStart: 35,
              responseStart: 5
            }
          ]
        }
        return []
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
    performance.getEntriesByType = originalGetEntriesByType
  })

  it('should collect navigation, fcp, lcp and fid metrics for the initial view', () => {
    const setLoadEvent = jasmine.createSpy('setLoadEvent')
    const scheduleViewUpdate = jasmine.createSpy('scheduleViewUpdate')
    const tracking = trackInitialViewMetrics(
      {},
      { relative: 0, timeStamp: Date.now() },
      setLoadEvent,
      scheduleViewUpdate
    )
    const image = document.createElement('img')
    image.id = 'hero-image'
    const input = document.createElement('input')
    input.id = 'email'
    document.body.appendChild(image)
    document.body.appendChild(input)

    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    getObserver('paint').callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            name: 'first-contentful-paint',
            startTime: 12
          }
        ]
      }
    })
    getObserver('largest-contentful-paint').callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 18,
            size: 100,
            element: image
          }
        ]
      }
    })
    getObserver('first-input').callback({
      getEntries() {
        return [
          {
            entryType: 'first-input',
            startTime: 22,
            processingStart: 30,
            target: input
          }
        ]
      }
    })

    expect(setLoadEvent).toHaveBeenCalledWith(40)
    expect(scheduleViewUpdate.calls.count()).toBe(4)
    expect(tracking.initialViewMetrics).toEqual({
      navigationTimings: jasmine.objectContaining({
        fetchStart: 1,
        responseEnd: 10,
        domComplete: 20,
        domContentLoaded: 30,
        domInteractive: 15,
        loadEvent: 40,
        firstByte: 5
      }),
      firstContentfulPaint: 12,
      largestContentfulPaint: {
        value: 18,
        targetSelector: '#hero-image'
      },
      firstInput: {
        delay: 8,
        time: 22,
        targetSelector: '#email'
      }
    })

    tracking.stop()

    expect(getObserver('paint').disconnect).toHaveBeenCalled()
    expect(getObserver('largest-contentful-paint').disconnect).toHaveBeenCalled()
    expect(getObserver('first-input').disconnect).toHaveBeenCalled()

    image.remove()
    input.remove()
  })

  it('should stop pending navigation reporting before the load event fires', () => {
    const setLoadEvent = jasmine.createSpy('setLoadEvent')
    const tracking = trackInitialViewMetrics(
      {},
      { relative: 0, timeStamp: Date.now() },
      setLoadEvent,
      jasmine.createSpy('scheduleViewUpdate')
    )

    tracking.stop()
    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(setLoadEvent).not.toHaveBeenCalled()
  })
})
