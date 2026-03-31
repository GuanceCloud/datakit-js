import {
  LifeCycleEventType,
  RumEventType,
  RumLongTaskEntryType
} from '@cloudcare/browser-core'
import { startLongTaskCollection } from './longTaskCollection'

describe('longTaskCollection', () => {
  let OriginalPerformanceObserver
  let originalGetEntriesByType

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((options) => {
        FakePerformanceObserver.observed.push(options)
      })
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instances.push(this)
    }
  }

  FakePerformanceObserver.instances = []
  FakePerformanceObserver.observed = []

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    originalGetEntriesByType = performance.getEntriesByType
    FakePerformanceObserver.instances = []
    FakePerformanceObserver.observed = []
    FakePerformanceObserver.supportedEntryTypes = ['longtask']
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

  it('should collect long task entries and stop the underlying subscription', () => {
    const lifeCycle = {
      notify: jasmine.createSpy('notify')
    }
    const collection = startLongTaskCollection(lifeCycle, {
      isIntakeUrl: () => false
    })
    const observer = FakePerformanceObserver.instances[0]
    const entry = {
      entryType: 'longtask',
      startTime: 42,
      duration: 18
    }

    observer.callback({
      getEntries() {
        return [entry]
      }
    })

    expect(lifeCycle.notify).toHaveBeenCalledTimes(1)
    expect(lifeCycle.notify.calls.argsFor(0)[0]).toBe(
      LifeCycleEventType.RAW_RUM_EVENT_COLLECTED
    )
    expect(lifeCycle.notify.calls.argsFor(0)[1]).toEqual(
      jasmine.objectContaining({
        startTime: 42,
        domainContext: { performanceEntry: entry },
        rawRumEvent: jasmine.objectContaining({
          type: RumEventType.LONG_TASK,
          longTask: jasmine.objectContaining({
            entryType: RumLongTaskEntryType.LONG_TASK,
            duration: 18 * 1e6
          })
        })
      })
    )

    collection.stop()

    expect(observer.disconnect).toHaveBeenCalled()
  })
})
