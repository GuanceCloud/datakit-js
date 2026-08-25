import { trackSoftNavigationMetrics } from './trackSoftNavigationMetrics'

describe('trackSoftNavigationMetrics', () => {
  let OriginalPerformanceObserver

  class FakePerformanceObserver {
    constructor(callback) {
      if (FakePerformanceObserver.failingConstruction) {
        throw new Error('constructor failed')
      }
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
    FakePerformanceObserver.failingConstruction = false
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
    window.PerformanceObserver = undefined
    globalThis.PerformanceObserver = undefined
    const tracking = trackSoftNavigationMetrics(jasmine.createSpy())

    expect(FakePerformanceObserver.instances.length).toBe(0)
    tracking()
  })

  it('keeps soft navigation tracking when ICP registration fails', () => {
    FakePerformanceObserver.failingEntryType = 'interaction-contentful-paint'
    const callback = jasmine.createSpy('callback')
    const tracking = trackSoftNavigationMetrics(callback)
    const observer = FakePerformanceObserver.instances[0]
    const entry = { entryType: 'soft-navigation' }

    observer.callback({ getEntries: () => [entry] })

    expect(observer.disconnect).not.toHaveBeenCalled()
    expect(callback.calls.argsFor(0)[0]).toBe(entry)
    tracking()
    expect(observer.disconnect).toHaveBeenCalled()
  })

  it('falls back when soft navigation registration fails', () => {
    FakePerformanceObserver.failingEntryType = 'soft-navigation'
    const tracking = trackSoftNavigationMetrics(jasmine.createSpy())
    const observer = FakePerformanceObserver.instances[0]

    expect(observer.disconnect).toHaveBeenCalled()
    tracking()
  })

  it('falls back when observer construction fails', () => {
    FakePerformanceObserver.failingConstruction = true

    const tracking = trackSoftNavigationMetrics(jasmine.createSpy())

    expect(FakePerformanceObserver.instances.length).toBe(0)
    tracking()
  })

  it('attempts registration when supported entry types are frozen', () => {
    FakePerformanceObserver.supportedEntryTypes = []

    const tracking = trackSoftNavigationMetrics(jasmine.createSpy())

    expect(FakePerformanceObserver.instances.length).toBe(1)
    tracking()
  })
})
