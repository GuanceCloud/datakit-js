import { sanitize } from './sanitize'
import { display } from './display'

describe('sanitize', () => {
  it('should replace circular references with their original path', () => {
    const source = { name: 'root' }
    source.self = source

    expect(sanitize(source)).toEqual({
      name: 'root',
      self: '[Reference seen at $]'
    })
  })

  it('should serialize unsupported primitive types', () => {
    expect(
      sanitize({
        big: BigInt('12'),
        fn: function namedFunction() {},
        symbol: Symbol('token')
      })
    ).toEqual({
      big: '[BigInt] 12',
      fn: '[Function] namedFunction',
      symbol: '[Symbol] token'
    })
  })

  it('should use toJSON when available and fall back when it throws', () => {
    const serializable = {
      toJSON() {
        return { value: 'from-to-json' }
      }
    }
    const faulty = {
      value: 'kept',
      toJSON() {
        throw new Error('broken')
      }
    }

    expect(sanitize(serializable)).toEqual({ value: 'from-to-json' })
    expect(sanitize(faulty)).toEqual({
      value: 'kept',
      toJSON: '[Function] toJSON'
    })
  })

  it('should sanitize native object types and DOM events', () => {
    const event = new Event('click')
    const pattern = /abc/

    expect(sanitize(pattern)).toBe('[RegExp] /abc/')
    expect(sanitize(event)).toEqual(
      jasmine.objectContaining({
        type: 'click',
        isTrusted: jasmine.any(Boolean),
        currentTarget: null,
        target: null
      })
    )
  })

  it('should return undefined and warn when the serialized payload is too large', () => {
    spyOn(display, 'warn')

    const result = sanitize('1234567890', 5)

    expect(result).toBeUndefined()
    expect(display.warn).toHaveBeenCalled()
  })

  it('should truncate nested containers when the size limit is reached', () => {
    spyOn(display, 'warn')

    const result = sanitize(
      {
        first: '1234',
        second: '5678',
        nested: { keep: 'value' }
      },
      20
    )

    expect(result).toEqual({
      first: '1234'
    })
    expect(display.warn).toHaveBeenCalled()
  })
})
