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
})
