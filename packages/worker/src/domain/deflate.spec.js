import { constants, Deflate, string2buf } from './deflate'

describe('worker/deflate', () => {
  it('should expose expected deflate constants', () => {
    expect(constants.Z_SYNC_FLUSH).toBe(2)
    expect(constants.Z_FINISH).toBe(4)
    expect(constants.Z_DEFAULT_COMPRESSION).toBe(-1)
  })

  it('should encode strings with TextEncoder when available', () => {
    expect(Array.from(string2buf('abc'))).toEqual([97, 98, 99])
  })

  it('should encode surrogate pairs without TextEncoder support', () => {
    const originalTextEncoder = globalThis.TextEncoder
    globalThis.TextEncoder = undefined

    expect(Array.from(string2buf('A😀'))).toEqual([65, 240, 159, 152, 128])

    globalThis.TextEncoder = originalTextEncoder
  })

  it('should encode 2-byte and 3-byte characters without TextEncoder support', () => {
    const originalTextEncoder = globalThis.TextEncoder
    globalThis.TextEncoder = undefined

    expect(Array.from(string2buf('é中'))).toEqual([195, 169, 228, 184, 173])

    globalThis.TextEncoder = originalTextEncoder
  })

  it('should deflate input and collect chunks through onData', () => {
    const deflate = new Deflate()

    const success = deflate.push(string2buf('hello worker'), constants.Z_SYNC_FLUSH)

    expect(success).toBeTrue()
    expect(deflate.err).toBe(0)
    expect(deflate.chunks.length).toBeGreaterThan(0)
    expect(deflate.chunks[0]).toEqual(jasmine.any(Uint8Array))
  })

  it('should accept ArrayBuffer input', () => {
    const deflate = new Deflate()
    const input = string2buf('buffer input').buffer

    const success = deflate.push(input, constants.Z_SYNC_FLUSH)

    expect(success).toBeTrue()
    expect(deflate.err).toBe(0)
    expect(deflate.chunks.length).toBeGreaterThan(0)
  })

  it('should finalize the stream when push is called with true', () => {
    const deflate = new Deflate()

    const success = deflate.push(string2buf('final chunk'), true)

    expect(success).toBeTrue()
    expect(deflate.ended).toBeTrue()
    expect(deflate.err).toBe(0)
    expect(deflate.result).toEqual(jasmine.any(Uint8Array))
    expect(deflate.chunks).toEqual([])
  })

  it('should return false when pushing after the stream has ended', () => {
    const deflate = new Deflate()

    expect(deflate.push(string2buf('done'), constants.Z_FINISH)).toBeTrue()
    expect(deflate.push(string2buf('again'), constants.Z_SYNC_FLUSH)).toBeFalse()
  })
})
