import { sanitizeUser, checkUser } from './user'
import { display } from '../helper/display'

describe('user helpers', () => {
  it('should stringify known user fields without mutating the input', () => {
    const input = {
      id: 123,
      name: false,
      email: null,
      extra: { role: 'admin' }
    }

    const result = sanitizeUser(input)

    expect(result).toEqual({
      id: '123',
      name: 'false',
      email: 'null',
      extra: { role: 'admin' }
    })
    expect(input).toEqual({
      id: 123,
      name: false,
      email: null,
      extra: { role: 'admin' }
    })
    expect(result).not.toBe(input)
  })

  it('should accept object users and reject unsupported values', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(checkUser({ id: 'user-1' })).toBeTrue()
    expect(displayErrorSpy).not.toHaveBeenCalled()

    expect(checkUser('invalid-user')).toBeFalse()
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'Unsupported user:',
      'invalid-user'
    )
  })
})
