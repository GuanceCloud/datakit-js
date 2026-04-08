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
    expect(entry.toJSON()).toEqual(
      jasmine.objectContaining({
        name: 'https://example.com/',
        startTime: 0,
        responseEnd: 42,
        entryType: 'resource',
        initiatorType: FAKE_INITIAL_DOCUMENT,
        toJSON: undefined
      })
    )
  })

  it('should wait for DOMContentLoaded when the document is still loading', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading'
    })
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([
        {
          name: 'https://example.com/loading',
          startTime: 1,
          responseEnd: 10,
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

    expect(callback).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('DOMContentLoaded'))

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        entryType: 'resource',
        initiatorType: FAKE_INITIAL_DOCUMENT,
        name: 'https://example.com/loading'
      })
    )
  })

  it('should emit immediately when the document is already interactive', () => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'interactive'
    })
    performance.getEntriesByType = jasmine
      .createSpy('getEntriesByType')
      .and.returnValue([
        {
          name: 'https://example.com/interactive',
          startTime: 2,
          responseEnd: 12,
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

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        entryType: 'resource',
        initiatorType: FAKE_INITIAL_DOCUMENT,
        name: 'https://example.com/interactive'
      })
    )
  })
})
