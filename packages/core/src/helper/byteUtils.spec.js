import { computeBytesCount, concatBuffers } from './byteUtils'

describe('byteUtils', () => {
  let originalTextEncoder

  beforeEach(() => {
    originalTextEncoder = window.TextEncoder
  })

  afterEach(() => {
    Object.defineProperty(window, 'TextEncoder', {
      configurable: true,
      value: originalTextEncoder
    })
  })

  it('should count ASCII characters by string length', () => {
    expect(computeBytesCount('abcd')).toBe(4)
  })

  it('should use TextEncoder for multibyte characters when available', () => {
    function FakeTextEncoder() {}
    FakeTextEncoder.prototype.encode = function (value) {
      return { length: value === '你' ? 3 : value.length }
    }

    Object.defineProperty(window, 'TextEncoder', {
      configurable: true,
      value: FakeTextEncoder
    })

    expect(computeBytesCount('你')).toBe(3)
  })

  it('should fall back to Blob size for multibyte characters when TextEncoder is unavailable', () => {
    Object.defineProperty(window, 'TextEncoder', {
      configurable: true,
      value: undefined
    })

    expect(computeBytesCount('你')).toBe(new Blob(['你']).size)
  })

  it('should concatenate binary buffers', () => {
    const result = concatBuffers([
      new Uint8Array([1, 2]),
      new Uint8Array([3]),
      new Uint8Array([4, 5])
    ])

    expect(Array.from(result)).toEqual([1, 2, 3, 4, 5])
  })
})
