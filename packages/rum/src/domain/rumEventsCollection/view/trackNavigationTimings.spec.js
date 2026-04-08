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

  it('should ignore invalid first byte values and stop pending callback', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackNavigationTimings({}, callback, () => ({
      fetchStart: 1,
      responseEnd: 10,
      domComplete: 20,
      domContentLoadedEventEnd: 30,
      domInteractive: 15,
      loadEventEnd: 40,
      loadEventStart: 35,
      domContentLoadedEventStart: 25,
      responseStart: -1
    }))

    window.dispatchEvent(new Event('load'))
    tracking.stop()
    jasmine.clock().tick(1)

    expect(callback).not.toHaveBeenCalled()

    trackNavigationTimings({}, callback, () => ({
      fetchStart: 1,
      responseEnd: 10,
      domComplete: 20,
      domContentLoadedEventEnd: 30,
      domInteractive: 15,
      loadEventEnd: 40,
      loadEventStart: 35,
      domContentLoadedEventStart: 25,
      responseStart: Number.MAX_SAFE_INTEGER
    }))

    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(callback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        firstByte: undefined
      })
    )
  })

  it('should keep domContentLoaded event start and end values in the processed payload', () => {
    const callback = jasmine.createSpy('callback')

    trackNavigationTimings({}, callback, () => ({
      fetchStart: 1,
      responseEnd: 10,
      domComplete: 20,
      domContentLoadedEventEnd: 30,
      domContentLoadedEventStart: 22,
      domInteractive: 15,
      loadEventEnd: 40,
      loadEventStart: 35,
      responseStart: 5
    }))

    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(callback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        domContentLoaded: 30,
        domContentLoadedEventEnd: 30,
        domContentLoadedEventStart: 22
      })
    )
  })

  it('should keep a zero first byte value when it is within the current page time', () => {
    const callback = jasmine.createSpy('callback')

    trackNavigationTimings({}, callback, () => ({
      fetchStart: 1,
      responseEnd: 10,
      domComplete: 20,
      domContentLoadedEventEnd: 30,
      domContentLoadedEventStart: 22,
      domInteractive: 15,
      loadEventEnd: 40,
      loadEventStart: 35,
      responseStart: 0
    }))

    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(callback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        firstByte: 0
      })
    )
  })

  it('should not schedule any callback when stopped before the load event fires', () => {
    const callback = jasmine.createSpy('callback')
    const tracking = trackNavigationTimings({}, callback, () => ({
      loadEventEnd: 40,
      responseStart: 5
    }))

    tracking.stop()
    window.dispatchEvent(new Event('load'))
    jasmine.clock().tick(1)

    expect(callback).not.toHaveBeenCalled()
  })
})
