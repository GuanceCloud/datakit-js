import { trackSoftNavigationMetrics } from './trackSoftNavigationMetrics'

describe('trackSoftNavigationMetrics', () => {
  let OriginalPerformanceObserver

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((options) => {
        if (options.type === FakePerformanceObserver.failingEntryType) {
          throw new Error('unsupported entry type')
        }
      })
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }
  }

  beforeEach(() => {
    jasmine.clock().install()
    OriginalPerformanceObserver = window.PerformanceObserver
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.failingEntryType = undefined
    FakePerformanceObserver.supportedEntryTypes = [
      'soft-navigation',
      'interaction-contentful-paint'
    ]
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('reports native soft navigation FCP and continuing LCP updates', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackSoftNavigationMetrics(callback)
    const observer = FakePerformanceObserver.instances[0]
    const softNavigationEntry = {
      entryType: 'soft-navigation',
      name: 'https://example.com/checkout',
      startTime: 100,
      presentationTime: 140,
      duration: 40,
      interactionId: 7,
      navigationType: 'push'
    }
    const interactionContentfulPaintEntry = {
      entryType: 'interaction-contentful-paint',
      startTime: 100,
      interactionId: 7
    }

    observer.callback({
      getEntries: () => [softNavigationEntry, interactionContentfulPaintEntry]
    })

    expect(observer.observe).toHaveBeenCalledWith({
      type: 'soft-navigation',
      buffered: true
    })
    expect(observer.observe).toHaveBeenCalledWith({
      type: 'interaction-contentful-paint',
      buffered: true
    })
    expect(callback.calls.argsFor(0)[0]).toBe(softNavigationEntry)
    expect(callback.calls.argsFor(1)[0]).toBe(interactionContentfulPaintEntry)

    tracking()
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('does not install observers when the API is unavailable', () => {
    FakePerformanceObserver.supportedEntryTypes = []
    const tracking = trackSoftNavigationMetrics(jasmine.createSpy())

    expect(FakePerformanceObserver.instances.length).toBe(0)
    tracking()
  })

  it('disconnects and falls back when observer registration fails', () => {
    FakePerformanceObserver.failingEntryType = 'interaction-contentful-paint'
    const callback = jasmine.createSpy('callback')
    const tracking = trackSoftNavigationMetrics(callback)
    const observer = FakePerformanceObserver.instances[0]

    expect(observer.disconnect).toHaveBeenCalled()
    expect(callback).not.toHaveBeenCalled()
    tracking()
  })
})
