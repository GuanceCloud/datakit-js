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

  it('should ignore entries after first hidden or maximum delay', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstContentfulPaint(
      {},
      {
        getTimeStamp: () => 20
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            name: 'first-contentful-paint',
            startTime: 21
          },
          {
            entryType: 'paint',
            name: 'first-contentful-paint',
            startTime: 700000
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should pick the first valid first-contentful-paint entry from a mixed paint list', () => {
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
          },
          {
            entryType: 'paint',
            name: 'first-contentful-paint',
            startTime: 40
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith(30)

    tracking.stop()
  })

  it('should disconnect the performance observer when stopped', () => {
    const tracking = trackFirstContentfulPaint(
      {},
      {
        getTimeStamp: () => Infinity
      },
      jasmine.createSpy('callback')
    )

    tracking.stop()

    expect(FakePerformanceObserver.instance.disconnect).toHaveBeenCalled()
  })

  it('should ignore paint entries that are not first-contentful-paint', () => {
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
            name: 'paint',
            startTime: 20
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should ignore entries that are not paint entries', () => {
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
            entryType: 'largest-contentful-paint',
            name: 'first-contentful-paint',
            startTime: 10
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should ignore first-contentful-paint entries at the first-hidden boundary', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackFirstContentfulPaint(
      {},
      {
        getTimeStamp: () => 30
      },
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            name: 'first-contentful-paint',
            startTime: 30
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })
})
