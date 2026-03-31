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
})
