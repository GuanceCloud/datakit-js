import { eventEmitter } from './eventEmitter'

describe('eventEmitter', () => {
  beforeEach(() => {
    eventEmitter._events = []
    eventEmitter.pendingEvents = []
  })

  it('should notify listeners registered for an event', () => {
    const callback = jasmine.createSpy('callback')

    eventEmitter.on('change', callback)
    eventEmitter.emit('change', 'payload', 42)

    expect(callback).toHaveBeenCalledWith('payload', 42)
  })

  it('should ignore listeners registered for other events', () => {
    const callback = jasmine.createSpy('callback')

    eventEmitter.on('change', callback)
    eventEmitter.emit('other')

    expect(callback).not.toHaveBeenCalled()
  })

  it('should bind the provided context to the listener callback', () => {
    const context = { marker: 'custom' }
    let callbackContext

    eventEmitter.on('change', function () {
      callbackContext = this
    }, context)
    eventEmitter.emit('change')

    expect(callbackContext).toBe(context)
  })

  it('should ignore non-function callbacks', () => {
    eventEmitter.on('change', undefined)

    expect(eventEmitter._events).toEqual([])
  })
})
