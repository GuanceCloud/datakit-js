import { addEventListener, addEventListeners } from './addEventListener'

describe('addEventListener helpers', () => {
  let target

  beforeEach(() => {
    target = new EventTarget()
  })

  it('should subscribe and unsubscribe from a single event', () => {
    const listener = jasmine.createSpy('listener')
    const subscription = addEventListener(target, 'change', listener)

    target.dispatchEvent(new Event('change'))
    expect(listener).toHaveBeenCalledTimes(1)

    subscription.stop()
    target.dispatchEvent(new Event('change'))
    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should support once across multiple events', () => {
    const listener = jasmine.createSpy('listener')

    addEventListeners(target, ['change', 'input'], listener, { once: true })

    target.dispatchEvent(new Event('change'))
    target.dispatchEvent(new Event('input'))

    expect(listener).toHaveBeenCalledTimes(1)
  })

  it('should pass capture and passive options when provided', () => {
    const addEventListenerSpy = spyOn(
      window.EventTarget.prototype,
      'addEventListener'
    ).and.callThrough()
    const removeEventListenerSpy = spyOn(
      window.EventTarget.prototype,
      'removeEventListener'
    ).and.callThrough()
    const listener = jasmine.createSpy('listener')

    const subscription = addEventListener(target, 'scroll', listener, {
      capture: true,
      passive: true
    })

    expect(addEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      jasmine.any(Function),
      { capture: true, passive: true }
    )

    subscription.stop()

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      'scroll',
      jasmine.any(Function),
      { capture: true, passive: true }
    )
  })

  it('should fall back to the patched method when the original one throws an illegal invocation error', () => {
    const listener = jasmine.createSpy('listener')
    const originalAdd = window.EventTarget.prototype.addEventListener
    const originalRemove = window.EventTarget.prototype.removeEventListener

    spyOn(window.EventTarget.prototype, 'addEventListener').and.callFake(
      function () {
        throw new Error('Illegal invocation')
      }
    )
    spyOn(window.EventTarget.prototype, 'removeEventListener').and.callFake(
      function () {
        throw new Error('Illegal invocation')
      }
    )

    target.addEventListener = originalAdd.bind(target)
    target.removeEventListener = originalRemove.bind(target)

    const subscription = addEventListener(target, 'change', listener)
    target.dispatchEvent(new Event('change'))

    expect(listener).toHaveBeenCalledTimes(1)

    subscription.stop()
  })
})
