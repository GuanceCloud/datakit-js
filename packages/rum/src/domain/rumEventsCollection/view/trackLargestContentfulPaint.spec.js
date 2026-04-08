import { trackLargestContentfulPaint } from './trackLargestContentfulPaint'

describe('trackLargestContentfulPaint', () => {
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
    FakePerformanceObserver.supportedEntryTypes = ['largest-contentful-paint']
    FakePerformanceObserver.instance = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should report the biggest valid lcp entry before first interaction and first hidden', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('div')
    target.setAttribute('data-testid', 'hero')
    document.body.appendChild(target)

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => 35
      },
      eventTarget,
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 20,
            size: 100,
            element: target
          },
          {
            entryType: 'largest-contentful-paint',
            startTime: 30,
            size: 200,
            element: target
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      value: 30,
      targetSelector: 'DIV[data-testid="hero"]'
    })

    eventTarget.dispatchEvent(new Event('pointerdown'))
    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 40,
            size: 300,
            element: target
          }
        ]
      }
    })

    expect(callback.calls.count()).toBe(1)

    tracking.stop()
    target.remove()
  })

  it('should ignore entries that are not bigger than the recorded size or exceed the maximum delay', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('div')
    target.setAttribute('data-testid', 'hero')
    document.body.appendChild(target)

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => Infinity
      },
      eventTarget,
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 20,
            size: 150,
            element: target
          }
        ]
      }
    })

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 25,
            size: 150,
            element: target
          },
          {
            entryType: 'largest-contentful-paint',
            startTime: 999999999,
            size: 300,
            element: target
          }
        ]
      }
    })

    expect(callback.calls.count()).toBe(1)

    tracking.stop()
    target.remove()
  })

  it('should stop accepting entries after a key interaction and allow missing target selectors', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => Infinity
      },
      eventTarget,
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 20,
            size: 150
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      value: 20,
      targetSelector: undefined
    })

    const event = new Event('keydown')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 25
    })
    eventTarget.dispatchEvent(event)

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 30,
            size: 300
          }
        ]
      }
    })

    expect(callback.calls.count()).toBe(1)

    tracking.stop()
  })

  it('should ignore entries that happen after the first hidden timestamp', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('div')
    target.setAttribute('data-testid', 'hero')
    document.body.appendChild(target)

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => 25
      },
      eventTarget,
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 30,
            size: 200,
            element: target
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
    target.remove()
  })

  it('should ignore non-lcp entries and keep the last bigger valid lcp from a mixed list', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('div')
    target.setAttribute('data-testid', 'hero')
    document.body.appendChild(target)

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => Infinity
      },
      eventTarget,
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'paint',
            startTime: 10,
            size: 100,
            element: target
          },
          {
            entryType: 'largest-contentful-paint',
            startTime: 20,
            size: 100,
            element: target
          },
          {
            entryType: 'largest-contentful-paint',
            startTime: 30,
            size: 200,
            element: target
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      value: 30,
      targetSelector: 'DIV[data-testid="hero"]'
    })

    tracking.stop()
    target.remove()
  })

  it('should disconnect the performance observer when stopped', () => {
    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => Infinity
      },
      new EventTarget(),
      jasmine.createSpy('callback')
    )

    tracking.stop()

    expect(FakePerformanceObserver.instance.disconnect).toHaveBeenCalled()
  })

  it('should ignore entries whose start time is equal to the first interaction time', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => Infinity
      },
      eventTarget,
      callback
    )

    const event = new Event('pointerdown')
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 25
    })
    eventTarget.dispatchEvent(event)

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 25,
            size: 200
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
  })

  it('should ignore entries at the first-hidden boundary', () => {
    const eventTarget = new EventTarget()
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('div')
    target.setAttribute('data-testid', 'hero')
    document.body.appendChild(target)

    const tracking = trackLargestContentfulPaint(
      {},
      {
        getTimeStamp: () => 30
      },
      eventTarget,
      callback
    )

    FakePerformanceObserver.instance.callback({
      getEntries() {
        return [
          {
            entryType: 'largest-contentful-paint',
            startTime: 30,
            size: 200,
            element: target
          }
        ]
      }
    })

    expect(callback).not.toHaveBeenCalled()

    tracking.stop()
    target.remove()
  })
})
