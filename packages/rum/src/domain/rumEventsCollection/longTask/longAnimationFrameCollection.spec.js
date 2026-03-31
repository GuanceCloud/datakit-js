import {
  LifeCycleEventType,
  RumEventType,
  RumLongTaskEntryType
} from '@cloudcare/browser-core'
import { startLongAnimationFrameCollection } from './longAnimationFrameCollection'

describe('longAnimationFrameCollection', () => {
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
    FakePerformanceObserver.supportedEntryTypes = ['long-animation-frame']
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

  it('should collect long animation frame entries with script details', () => {
    const lifeCycle = {
      notify: jasmine.createSpy('notify')
    }
    const collection = startLongAnimationFrameCollection(lifeCycle, {
      isIntakeUrl: () => false
    })
    const observer = FakePerformanceObserver.instances[0]
    const entry = {
      startTime: 30,
      duration: 20,
      blockingDuration: 10,
      firstUIEventTimestamp: 12,
      renderStart: 14,
      styleAndLayoutStart: 16,
      scripts: [
        {
          duration: 7,
          pauseDuration: 2,
          forcedStyleAndLayoutDuration: 1,
          startTime: 31,
          executionStart: 32,
          sourceURL: 'https://example.com/app.js',
          sourceFunctionName: 'render',
          sourceCharPosition: 123,
          invoker: 'event-listener',
          invokerType: 'click',
          windowAttribution: 'self'
        }
      ]
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
        startTime: 30,
        domainContext: { performanceEntry: entry },
        rawRumEvent: jasmine.objectContaining({
          type: RumEventType.LONG_TASK,
          longTask: jasmine.objectContaining({
            entryType: RumLongTaskEntryType.LONG_ANIMATION_FRAME,
            duration: 20 * 1e6,
            blockingDuration: 10 * 1e6,
            scripts: [
              jasmine.objectContaining({
                duration: 7 * 1e6,
                pause_duration: 2 * 1e6,
                forced_style_and_layout_duration: 1 * 1e6,
                source_url: 'https://example.com/app.js',
                source_function_name: 'render',
                source_char_position: 123,
                invoker: 'event-listener',
                invoker_type: 'click',
                window_attribution: 'self'
              })
            ]
          })
        })
      })
    )

    collection.stop()

    expect(observer.disconnect).toHaveBeenCalled()
  })
})
