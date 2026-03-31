import { retrieveFirstInputTiming } from './firstInputPolyfill'

describe('firstInputPolyfill', () => {
  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-03-31T00:00:00.000Z'))
    spyOn(window.performance, 'now').and.returnValues(
      20,
      20,
      25,
      25,
      30,
      30,
      35,
      35
    )
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should report the first cancelable input timing', () => {
    const callback = jasmine.createSpy('callback')

    retrieveFirstInputTiming({}, callback)
    jasmine.clock().tick(50)

    const event = new Event('click', { cancelable: true, bubbles: true })
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 5
    })
    window.dispatchEvent(event)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        entryType: 'first-input',
        startTime: 5
      })
    )
    expect(callback.calls.mostRecent().args[0].processingStart).toBeGreaterThan(0)
    expect(callback.calls.mostRecent().args[0].processingEnd).toBeGreaterThan(0)
  })

  it('should ignore non-cancelable events', () => {
    const callback = jasmine.createSpy('callback')

    retrieveFirstInputTiming({}, callback)
    jasmine.clock().tick(50)

    const event = new Event('keydown', { bubbles: true, cancelable: false })
    Object.defineProperty(event, 'timeStamp', {
      configurable: true,
      value: 5
    })
    window.dispatchEvent(event)

    expect(callback).not.toHaveBeenCalled()
  })

  it('should wait for pointerup and ignore pointercancel', () => {
    const callback = jasmine.createSpy('callback')

    retrieveFirstInputTiming({}, callback)
    jasmine.clock().tick(50)

    const pointerDown = new Event('pointerdown', {
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(pointerDown, 'timeStamp', {
      configurable: true,
      value: 10
    })
    window.dispatchEvent(pointerDown)
    window.dispatchEvent(new Event('pointercancel', { bubbles: true }))

    expect(callback).not.toHaveBeenCalled()

    const nextPointerDown = new Event('pointerdown', {
      bubbles: true,
      cancelable: true
    })
    Object.defineProperty(nextPointerDown, 'timeStamp', {
      configurable: true,
      value: 10
    })
    window.dispatchEvent(nextPointerDown)
    window.dispatchEvent(new Event('pointerup', { bubbles: true }))

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
