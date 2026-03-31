import { createBoundedBuffer } from './boundedBuffer'

describe('createBoundedBuffer', () => {
  it('should drain buffered callbacks with the provided argument', () => {
    const buffer = createBoundedBuffer()
    const firstCallback = jasmine.createSpy('firstCallback')
    const secondCallback = jasmine.createSpy('secondCallback')

    buffer.add(firstCallback)
    buffer.add(secondCallback)
    buffer.drain('payload')

    expect(firstCallback).toHaveBeenCalledWith('payload')
    expect(secondCallback).toHaveBeenCalledWith('payload')
  })

  it('should empty the buffer after draining', () => {
    const buffer = createBoundedBuffer()
    const callback = jasmine.createSpy('callback')

    buffer.add(callback)
    buffer.drain()
    buffer.drain()

    expect(callback).toHaveBeenCalledTimes(1)
  })

  it('should remove a callback from the buffer', () => {
    const buffer = createBoundedBuffer()
    const removedCallback = jasmine.createSpy('removedCallback')
    const keptCallback = jasmine.createSpy('keptCallback')

    buffer.add(removedCallback)
    buffer.add(keptCallback)
    buffer.remove(removedCallback)
    buffer.drain()

    expect(removedCallback).not.toHaveBeenCalled()
    expect(keptCallback).toHaveBeenCalledTimes(1)
  })

  it('should keep only the most recent callbacks when the buffer limit is reached', () => {
    const buffer = createBoundedBuffer()
    const firstCallback = jasmine.createSpy('firstCallback')
    const keptCallbacks = Array.from({ length: 500 }, (_, index) =>
      jasmine.createSpy(`callback${index}`)
    )

    buffer.add(firstCallback)
    keptCallbacks.forEach((callback) => buffer.add(callback))
    buffer.drain()

    expect(firstCallback).not.toHaveBeenCalled()
    keptCallbacks.forEach((callback) =>
      expect(callback).toHaveBeenCalledTimes(1)
    )
  })
})
