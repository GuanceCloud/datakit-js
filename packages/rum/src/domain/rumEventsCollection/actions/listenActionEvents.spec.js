import { listenActionEvents } from './listenActionEvents'

describe('listenActionEvents', () => {
  let originalGetSelection
  let target

  beforeEach(() => {
    originalGetSelection = window.getSelection
    target = document.createElement('button')
    document.body.appendChild(target)
  })

  afterEach(() => {
    window.getSelection = originalGetSelection
    target.remove()
  })

  function dispatchPointerEvent(type, options) {
    const event = new Event(type, { bubbles: true })
    Object.assign(event, { isPrimary: true }, options)
    target.dispatchEvent(event)
  }

  it('should wire pointer down/up and capture user activity', () => {
    let selectionCollapsed = true
    window.getSelection = () => ({ isCollapsed: selectionCollapsed })

    const onPointerDown = jasmine
      .createSpy('onPointerDown')
      .and.returnValue({ clickId: '1' })
    const onPointerUp = jasmine.createSpy('onPointerUp')
    const listeners = listenActionEvents({
      onPointerDown,
      onPointerUp
    })

    dispatchPointerEvent('pointerdown')
    selectionCollapsed = false
    document.dispatchEvent(new Event('selectionchange'))
    window.dispatchEvent(new Event('scroll'))
    target.dispatchEvent(new Event('input', { bubbles: true }))
    dispatchPointerEvent('pointerup')

    expect(onPointerDown).toHaveBeenCalled()
    expect(onPointerUp).toHaveBeenCalled()

    const userActivity = onPointerUp.calls.mostRecent().args[2]()
    expect(userActivity).toEqual({
      selection: true,
      input: true,
      scroll: true
    })

    listeners.stop()
  })

  it('should ignore non-primary or invalid pointer events', () => {
    const onPointerDown = jasmine
      .createSpy('onPointerDown')
      .and.returnValue({ clickId: '1' })
    const onPointerUp = jasmine.createSpy('onPointerUp')
    const listeners = listenActionEvents({
      onPointerDown,
      onPointerUp
    })

    const invalidEvent = new Event('pointerdown', { bubbles: true })
    Object.assign(invalidEvent, { isPrimary: false })
    target.dispatchEvent(invalidEvent)
    target.dispatchEvent(new Event('pointerup', { bubbles: true }))

    expect(onPointerDown).not.toHaveBeenCalled()
    expect(onPointerUp).not.toHaveBeenCalled()

    listeners.stop()
  })

  it('should ignore pointerup events when no click context was created', () => {
    const onPointerDown = jasmine
      .createSpy('onPointerDown')
      .and.returnValue(undefined)
    const onPointerUp = jasmine.createSpy('onPointerUp')
    const listeners = listenActionEvents({
      onPointerDown,
      onPointerUp
    })

    dispatchPointerEvent('pointerdown')
    dispatchPointerEvent('pointerup')

    expect(onPointerDown).toHaveBeenCalled()
    expect(onPointerUp).not.toHaveBeenCalled()

    listeners.stop()
  })
})
