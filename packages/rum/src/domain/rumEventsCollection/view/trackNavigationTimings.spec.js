import { trackNavigationTimings } from './trackNavigationTimings'

describe('trackNavigationTimings', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should report processed navigation timings after load', () => {
    const callback = jasmine.createSpy('callback')
    const stop = trackNavigationTimings({}, callback, () => ({
      fetchStart: 1,
      responseEnd: 10,
      domComplete: 20,
      domContentLoadedEventEnd: 30,
      domInteractive: 15,
      loadEventEnd: 40,
      loadEventStart: 35,
      domContentLoadedEventStart: 25,
      responseStart: 5
    }))

    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(callback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        fetchStart: 1,
        responseEnd: 10,
        domComplete: 20,
        domContentLoaded: 30,
        domInteractive: 15,
        loadEvent: 40,
        firstByte: 5
      })
    )

    stop.stop()
  })

  it('should ignore incomplete navigation entries', () => {
    const callback = jasmine.createSpy('callback')

    trackNavigationTimings({}, callback, () => ({
      loadEventEnd: 0
    }))

    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(callback).not.toHaveBeenCalled()
  })
})
