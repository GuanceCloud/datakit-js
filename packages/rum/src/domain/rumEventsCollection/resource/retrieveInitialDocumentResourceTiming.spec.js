import { FAKE_INITIAL_DOCUMENT } from './resourceUtils'
import { retrieveInitialDocumentResourceTiming } from './retrieveInitialDocumentResourceTiming'

describe('retrieveInitialDocumentResourceTiming', () => {
  let originalReadyState
  let originalGetEntriesByType
  let OriginalPerformanceObserver

  beforeEach(() => {
    originalReadyState = document.readyState
    originalGetEntriesByType = performance.getEntriesByType
    OriginalPerformanceObserver = window.PerformanceObserver
    class FakePerformanceObserver {}
    FakePerformanceObserver.supportedEntryTypes = ['navigation']
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
  })

  afterEach(() => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: originalReadyState
    })
    performance.getEntriesByType = originalGetEntriesByType
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should emit a fake initial document resource entry when ready', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete'
    })
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([
        {
          name: 'https://example.com/',
          startTime: 0,
          responseEnd: 42,
          toJSON() {
            return {
              name: this.name,
              startTime: this.startTime,
              responseEnd: this.responseEnd
            }
          }
        }
      ])
    const callback = jasmine.createSpy('callback')

    retrieveInitialDocumentResourceTiming({}, callback)

    const entry = callback.calls.mostRecent().args[0]
    expect(callback).toHaveBeenCalledTimes(1)
    expect(entry.entryType).toBe('resource')
    expect(entry.initiatorType).toBe(FAKE_INITIAL_DOCUMENT)
    expect(entry.toJSON().toJSON).toBeUndefined()
  })
})
