import {
  buildUrl,
  getHash,
  getOrigin,
  getPathName,
  getSearch,
  isValidUrl,
  normalizeUrl
} from './urlPolyfill'

describe('urlPolyfill', () => {
  it('should normalize relative urls against the current origin', () => {
    expect(normalizeUrl('/test?a=1#hash')).toMatch(/^https?:\/\/.*\/test\?a=1#hash$/)
  })

  it('should expose origin, pathname, search and hash helpers', () => {
    const url = 'https://example.com:8080/path/name?query=1#section'

    expect(getOrigin(url)).toBe('https://example.com:8080')
    expect(getPathName(url)).toBe('/path/name')
    expect(getSearch(url)).toBe('?query=1')
    expect(getHash(url)).toBe('#section')
  })

  it('should validate URLs and reject invalid relative urls without a base', () => {
    expect(isValidUrl('https://example.com/path')).toBeTrue()
    expect(isValidUrl('::not-a-url::')).toBeFalse()
    expect(() => buildUrl('/relative')).toThrow()
  })

  it('should build relative urls when a base is provided', () => {
    const url = buildUrl('/child', 'https://example.com/root')

    expect(url.href).toBe('https://example.com/child')
  })
})
