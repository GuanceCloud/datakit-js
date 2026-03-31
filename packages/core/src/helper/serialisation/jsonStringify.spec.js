import { detachToJsonMethod, jsonStringify } from './jsonStringify'

describe('jsonStringify', () => {
  it('should ignore custom toJSON methods on plain objects', () => {
    const value = {
      a: 1,
      toJSON() {
        return 'overridden'
      }
    }

    expect(jsonStringify(value)).toBe('{"a":1}')
  })

  it('should restore detached toJSON methods after serialization', () => {
    const value = {
      a: 1,
      toJSON() {
        return 'overridden'
      }
    }

    jsonStringify(value)

    expect(value.toJSON()).toBe('overridden')
  })

  it('should return a fallback string when serialization throws', () => {
    const value = {
      get broken() {
        throw new Error('boom')
      }
    }

    expect(jsonStringify(value)).toBe('<error: unable to serialize object>')
  })

  it('should detach and restore a toJSON method manually', () => {
    const value = {
      toJSON() {
        return 'overridden'
      }
    }

    const restore = detachToJsonMethod(value)

    expect(value.toJSON).toBeUndefined()

    restore()

    expect(value.toJSON()).toBe('overridden')
  })
})
