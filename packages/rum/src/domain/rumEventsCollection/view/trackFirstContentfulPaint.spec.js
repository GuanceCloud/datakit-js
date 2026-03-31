import { trackFirstContentfulPaint } from './trackFirstContentfulPaint'

describe('trackFirstContentfulPaint', () => {
  let OriginalPerformanceObserver

  class FakePerformanceObserver {
    constructor(callback) {
      this.callback = callback
      this.observe = jasmine.createSpy('observe')
      this.disconnect = jasmine.createSpy('disconnect')
      FakePerformanceObserver.instance = this
    }
  }

  beforeEach(() => {
    OriginalPerformanceObserver = window.PerformanceObserver
    window.PerformanceObserver = FakePerformanceObserver
    globalThis.PerformanceObserver = FakePerformanceObserver
    FakePerformanceObserver.supportedEntryTypes = ['paint']
    FakePerformanceObserver.instance = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should report the first contentful paint before the first hidden time', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstContentfulPaint(
      {},
      {
        getTimeStamp: () => 100
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            name: 'first-paint',
            startTime: 10
          },
          {
            entryType: 'paint',
            name: 'first-contentful-paint',
            startTime: 30
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith(30)

    tracking.stop()
    expect(FakePerformanceObserver.instance.disconnect).toHaveBeenCalled()
  })
})
