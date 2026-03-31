import {
  computeTimingsFromDeprecatedPerformanceTiming,
  getNavigationEntry
} from './performanceUtils'
import { RumPerformanceEntryType } from './performanceObservable'

describe('performanceUtils', () => {
  let originalPerformanceObserver
  let originalGetEntriesByType
  let originalTiming

  beforeEach(() => {
    originalPerformanceObserver = window.PerformanceObserver
    originalGetEntriesByType = performance.getEntriesByType
    originalTiming = performance.timing
  })

  afterEach(() => {
    window.PerformanceObserver = originalPerformanceObserver
    performance.getEntriesByType = originalGetEntriesByType
    Object.defineProperty(performance, 'timing', {
      configurable: true,
      value: originalTiming
    })
  })

  it('should return the navigation performance entry when supported', () => {
    const navigationEntry = { entryType: RumPerformanceEntryType.NAVIGATION }

    window.PerformanceObserver = {
      supportedEntryTypes: [RumPerformanceEntryType.NAVIGATION]
    }
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([navigationEntry])

    expect(getNavigationEntry()).toBe(navigationEntry)
    expect(performance.getEntriesByType).toHaveBeenCalledWith(
      RumPerformanceEntryType.NAVIGATION
    )
  })

  it('should compute a navigation-like entry from deprecated performance timing', () => {
    window.PerformanceObserver = {
      supportedEntryTypes: []
    }
    Object.defineProperty(performance, 'timing', {
      configurable: true,
      value: {
        navigationStart: 1000,
        domComplete: 1450,
        responseEnd: 1200,
        secureConnectionStart: 0
      }
    })

    const timings = computeTimingsFromDeprecatedPerformanceTiming()
    const entry = getNavigationEntry()

    expect(entry.entryType).toBe(RumPerformanceEntryType.NAVIGATION)
    expect(entry.initiatorType).toBe('navigation')
    expect(entry.startTime).toBe(0)
    expect(entry.duration).toBe(timings.responseEnd)
    expect(entry.domComplete).toBe(timings.domComplete)
    expect(entry.responseEnd).toBe(timings.responseEnd)
    expect(entry.secureConnectionStart).toBe(0)
    expect(entry.toJSON()).toEqual(
      jasmine.objectContaining({
        entryType: RumPerformanceEntryType.NAVIGATION,
        responseEnd: timings.responseEnd
      })
    )
  })

  it('should compute relative timings only for numeric values', () => {
    Object.defineProperty(performance, 'timing', {
      configurable: true,
      value: {
        navigationStart: 500,
        fetchStart: 520,
        domInteractive: 650,
        redirectCount: '2',
        connectEnd: 0
      }
    })

    const timings = computeTimingsFromDeprecatedPerformanceTiming()

    expect(timings.redirectCount).toBeUndefined()
    expect(timings.fetchStart - timings.navigationStart).toBe(20)
    expect(timings.domInteractive - timings.navigationStart).toBe(150)
    expect(timings.connectEnd).toBe(0)
  })
})
