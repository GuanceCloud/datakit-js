import { trackFirstInput } from './trackFirstInput'

describe('trackFirstInput', () => {
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
    FakePerformanceObserver.supportedEntryTypes = ['first-input']
    FakePerformanceObserver.instance = undefined
  })

  afterEach(() => {
    window.PerformanceObserver = OriginalPerformanceObserver
    globalThis.PerformanceObserver = OriginalPerformanceObserver
  })

  it('should report first input delay and selector before first hidden', () => {
    const callback = jasmine.createSpy('callback')
    const target = document.createElement('button')
    target.setAttribute('data-testid', 'confirm')
    document.body.appendChild(target)

    const tracking = trackFirstInput(
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
            entryType: 'first-input',
            startTime: 40,
            processingStart: 55,
            target
          }
        ]
      }
    })

    expect(callback).toHaveBeenCalledWith({
      delay: 15,
      time: 40,
      targetSelector: 'BUTTON[data-testid="confirm"]'
    })

    tracking.stop()
    target.remove()
  })
})
