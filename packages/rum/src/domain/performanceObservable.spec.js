import {
  createPerformanceObservable,
  RumPerformanceEntryType,
  supportPerformanceTimingEvent
} from './performanceObservable'

describe('performanceObservable', () => {
  let OriginalPerformanceObserver
  let originalGetEntriesByType

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((options) => {
        if (FakePerformanceObserver.shouldThrowOnObserve) {
          FakePerformanceObserver.shouldThrowOnObserve = false
          throw new Error('unsupported')
        }
        FakePerformanceObserver.observed.push(options)
      })
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }
  }

  FakePerformanceObserver.instances = []
  FakePerformanceObserver.observed = []
  FakePerformanceObserver.shouldThrowOnObserve = false

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    originalGetEntriesByType = performance.getEntriesByType
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.observed = []
    FakePerformanceObserver.shouldThrowOnObserve = false
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([])
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
    performance.getEntriesByType = originalGetEntriesByType
  })

  it('should report supported performance entry types', () => {
    FakePerformanceObserver.supportedEntryTypes = [
      RumPerformanceEntryType.RESOURCE,
      RumPerformanceEntryType.FIRST_INPUT
    ]

    expect(
      supportPerformanceTimingEvent(RumPerformanceEntryType.RESOURCE)
    ).toBeTrue()
    expect(
      supportPerformanceTimingEvent(RumPerformanceEntryType.NAVIGATION)
    ).toBeFalse()
  })

  it('should notify only allowed performance resource entries', () => {
    FakePerformanceObserver.supportedEntryTypes = [RumPerformanceEntryType.RESOURCE]

    const subscriber = jasmine.createSpy('subscriber')
    const observable = createPerformanceObservable(
      {
        isIntakeUrl: (url) => url.indexOf('intake') >= 0
      },
      {
        type: RumPerformanceEntryType.RESOURCE
      }
    )

    const subscription = observable.subscribe(subscriber)
    const observer = FakePerformanceObserver.instances[0]

    observer.callback({
      getEntries() {
        return [
          {
            entryType: RumPerformanceEntryType.RESOURCE,
            name: 'https://example.com/asset.js',
            duration: 10
          },
          {
            entryType: RumPerformanceEntryType.RESOURCE,
            name: 'https://example.com/intake',
            duration: 10
          },
          {
            entryType: RumPerformanceEntryType.RESOURCE,
            name: 'https://example.com/negative',
            duration: -1
          }
        ]
      }
    })

    expect(subscriber).toHaveBeenCalledWith([
      {
        entryType: RumPerformanceEntryType.RESOURCE,
        name: 'https://example.com/asset.js',
        duration: 10
      }
    ])

    subscription.unsubscribe()
    expect(observer.disconnect).toHaveBeenCalled()
  })

})
