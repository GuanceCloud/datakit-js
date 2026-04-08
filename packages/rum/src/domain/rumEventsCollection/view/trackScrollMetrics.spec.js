import { Observable } from '@cloudcare/browser-core'
import { trackScrollMetrics } from './trackScrollMetrics'

describe('trackScrollMetrics', () => {
  it('should track maximum depth and scroll height updates', () => {
    const scrollValues = new Observable()
    const callback = jasmine.createSpy('callback')
    const tracker = trackScrollMetrics(
      {},
      { relative: 10 },
      callback,
      scrollValues
    )

    scrollValues.notify({
      scrollDepth: 100,
      scrollTop: 20,
      scrollHeight: 200
    })
    scrollValues.notify({
      scrollDepth: 120,
      scrollTop: 40,
      scrollHeight: 210
    })

    expect(callback.calls.count()).toBe(2)
    expect(callback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        maxDepth: 120,
        maxDepthScrollTop: 40,
        maxScrollHeight: 210
      })
    )

    tracker.stop()
  })

  it('should ignore regressions and cap max depth by the max scroll height', () => {
    const scrollValues = new Observable()
    const callback = jasmine.createSpy('callback')
    const tracker = trackScrollMetrics(
      {},
      { relative: 10 },
      callback,
      scrollValues
    )

    scrollValues.notify({
      scrollDepth: 300,
      scrollTop: 180,
      scrollHeight: 200
    })
    scrollValues.notify({
      scrollDepth: 150,
      scrollTop: 20,
      scrollHeight: 190
    })

    expect(callback.calls.count()).toBe(1)
    expect(callback).toHaveBeenCalledWith({
      maxDepth: 200,
      maxDepthScrollTop: 180,
      maxScrollHeight: 200,
      maxScrollHeightTime: jasmine.any(Number)
    })

    tracker.stop()
  })

  it('should stop reacting to scroll updates after stop is called', () => {
    const scrollValues = new Observable()
    const callback = jasmine.createSpy('callback')
    const tracker = trackScrollMetrics(
      {},
      { relative: 10 },
      callback,
      scrollValues
    )

    tracker.stop()
    scrollValues.notify({
      scrollDepth: 120,
      scrollTop: 40,
      scrollHeight: 210
    })

    expect(callback).not.toHaveBeenCalled()
  })

  it('should update when only the max scroll height increases', () => {
    const scrollValues = new Observable()
    const callback = jasmine.createSpy('callback')
    const tracker = trackScrollMetrics(
      {},
      { relative: 10 },
      callback,
      scrollValues
    )

    scrollValues.notify({
      scrollDepth: 100,
      scrollTop: 20,
      scrollHeight: 200
    })
    scrollValues.notify({
      scrollDepth: 90,
      scrollTop: 25,
      scrollHeight: 250
    })

    expect(callback.calls.count()).toBe(2)
    expect(callback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        maxDepth: 100,
        maxDepthScrollTop: 25,
        maxScrollHeight: 250
      })
    )

    tracker.stop()
  })

  it('should not emit when scroll metrics stay unchanged', () => {
    const scrollValues = new Observable()
    const callback = jasmine.createSpy('callback')
    const tracker = trackScrollMetrics(
      {},
      { relative: 10 },
      callback,
      scrollValues
    )

    scrollValues.notify({
      scrollDepth: 100,
      scrollTop: 20,
      scrollHeight: 200
    })
    scrollValues.notify({
      scrollDepth: 100,
      scrollTop: 20,
      scrollHeight: 200
    })

    expect(callback.calls.count()).toBe(1)

    tracker.stop()
  })
})
