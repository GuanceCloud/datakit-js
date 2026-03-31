import {
  callMonitored,
  monitor,
  resetMonitor,
  setDebugMode,
  startMonitorErrorCollection
} from './monitor'
import { display } from './display'

describe('monitor', () => {
  afterEach(() => {
    resetMonitor()
  })

  it('should preserve the calling context through monitor()', () => {
    const context = {
      value: 2,
      compute: monitor(function (increment) {
        return this.value + increment
      })
    }

    expect(context.compute(3)).toBe(5)
  })

  it('should collect monitored errors instead of throwing them', () => {
    const onMonitorErrorCollected = jasmine.createSpy('onMonitorErrorCollected')
    startMonitorErrorCollection(onMonitorErrorCollected)

    const result = callMonitored(
      function () {
        throw new Error('boom')
      },
      undefined,
      []
    )

    expect(result).toBeUndefined()
    expect(onMonitorErrorCollected).toHaveBeenCalled()
    expect(onMonitorErrorCollected.calls.mostRecent().args[0].message).toBe(
      'boom'
    )
  })

  it('should display monitor errors when debug mode is enabled', () => {
    const displayErrorSpy = spyOn(display, 'error')
    setDebugMode(true)

    callMonitored(
      function () {
        throw new Error('debug-boom')
      },
      undefined,
      []
    )

    expect(displayErrorSpy).toHaveBeenCalled()
    expect(displayErrorSpy.calls.mostRecent().args[0]).toBe('[MONITOR]')
  })

  it('should swallow errors thrown by the monitor error collector', () => {
    const displayErrorSpy = spyOn(display, 'error')

    startMonitorErrorCollection(function () {
      throw new Error('collector-failed')
    })
    setDebugMode(true)

    callMonitored(
      function () {
        throw new Error('boom')
      },
      undefined,
      []
    )

    expect(displayErrorSpy).toHaveBeenCalledTimes(2)
  })
})
