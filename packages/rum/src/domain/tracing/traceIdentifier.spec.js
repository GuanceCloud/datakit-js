import {
  createRandomHexIdentifier,
  getCrypto,
  normalizeHexIdentifier,
  TraceIdentifier
} from './traceIdentifier'

describe('traceIdentifier', () => {
  let originalCryptoDescriptor
  let originalMsCryptoDescriptor

  beforeEach(() => {
    originalCryptoDescriptor = Object.getOwnPropertyDescriptor(window, 'crypto')
    originalMsCryptoDescriptor = Object.getOwnPropertyDescriptor(window, 'msCrypto')
  })

  afterEach(() => {
    if (originalCryptoDescriptor) {
      Object.defineProperty(window, 'crypto', originalCryptoDescriptor)
    }
    if (originalMsCryptoDescriptor) {
      Object.defineProperty(window, 'msCrypto', originalMsCryptoDescriptor)
    }
  })

  it('should create a positive identifier from crypto random values', () => {
    const getRandomValues = jasmine.createSpy('getRandomValues').and.callFake((buffer) => {
      buffer.set([255, 254, 253, 252, 1, 2, 3, 4])
      return buffer
    })
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: { getRandomValues }
    })

    const identifier = new TraceIdentifier()

    expect(getRandomValues).toHaveBeenCalled()
    expect(identifier.readInt32(0)).toBeGreaterThanOrEqual(0)
    expect(identifier.toDecimalString()).toEqual(jasmine.any(String))
    expect(identifier.toPaddedHexadecimalString()).toMatch(/^[0-9a-f]{16}$/)
    expect(identifier.toPaddedHexadecimalString().startsWith('7f')).toBeTrue()
  })

  it('should fallback to msCrypto when crypto is unavailable', () => {
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'msCrypto', {
      configurable: true,
      value: {
        getRandomValues(buffer) {
          buffer.set([0, 0, 0, 1, 0, 0, 0, 2])
          return buffer
        }
      }
    })

    expect(getCrypto()).toBe(window.msCrypto)
    expect(new TraceIdentifier().toString(16)).toBe('100000002')
  })

  it('should create full-width random hexadecimal identifiers', () => {
    const getRandomValues = jasmine.createSpy('getRandomValues').and.callFake((buffer) => {
      buffer.set([255, 254, 253, 252, 1, 2, 3, 4])
      return buffer
    })
    Object.defineProperty(window, 'crypto', {
      configurable: true,
      value: { getRandomValues }
    })

    expect(createRandomHexIdentifier(8)).toBe('fffefdfc01020304')
  })

  it('should normalize valid hexadecimal identifiers and reject invalid ones', () => {
    expect(normalizeHexIdentifier('ABCDEF1234567890', [16, 32])).toBe('abcdef1234567890')
    expect(normalizeHexIdentifier('abc-def', [16, 32])).toBeUndefined()
    expect(normalizeHexIdentifier('xyz', [16, 32])).toBeUndefined()
  })
})
