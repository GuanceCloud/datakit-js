import { catchUserErrors } from './catchUserErrors'
import { display } from './display'

describe('catchUserErrors', () => {
  it('should return the wrapped function result', () => {
    const wrapped = catchUserErrors((value) => value.toUpperCase(), 'failed')

    expect(wrapped('ok')).toBe('OK')
  })

  it('should preserve the function context and arguments', () => {
    const context = { prefix: 'ctx:' }
    const wrapped = catchUserErrors(function (value) {
      return this.prefix + value
    }, 'failed')

    expect(wrapped.call(context, 'value')).toBe('ctx:value')
  })

  it('should report thrown errors instead of rethrowing them', () => {
    const error = new Error('boom')
    const wrapped = catchUserErrors(() => {
      throw error
    }, 'custom message')

    spyOn(display, 'error')

    expect(() => wrapped()).not.toThrow()
    expect(display.error).toHaveBeenCalledWith('custom message', error)
  })
})
