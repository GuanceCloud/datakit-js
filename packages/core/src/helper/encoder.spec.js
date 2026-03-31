import { createIdentityEncoder } from './encoder'

describe('encoder', () => {
  it('should accumulate written data and expose byte counts', () => {
    const encoder = createIdentityEncoder()
    const callback = jasmine.createSpy('callback')

    expect(encoder.isAsync).toBeFalse()
    expect(encoder.isEmpty()).toBeTrue()
    expect(encoder.estimateEncodedBytesCount('abc')).toBe(3)

    encoder.write('ab', callback)
    encoder.write('c')

    expect(callback).toHaveBeenCalledWith(2)
    expect(encoder.isEmpty()).toBeFalse()

    const result = encoder.finishSync()

    expect(result).toEqual({
      output: 'abc',
      outputBytesCount: 3,
      rawBytesCount: 3,
      pendingData: []
    })
    expect(encoder.isEmpty()).toBeTrue()
  })

  it('should support async-style finish callbacks and reset after finishing', () => {
    const encoder = createIdentityEncoder()
    const finishCallback = jasmine.createSpy('finishCallback')

    encoder.write('hello')
    encoder.finish(finishCallback)

    expect(finishCallback).toHaveBeenCalledWith({
      output: 'hello',
      outputBytesCount: 5,
      rawBytesCount: 5,
      pendingData: []
    })

    expect(encoder.finishSync()).toEqual({
      output: '',
      outputBytesCount: 0,
      rawBytesCount: 0,
      pendingData: []
    })
  })
})
