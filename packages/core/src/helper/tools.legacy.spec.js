import {
  autoExeQueue,
  base64Encode,
  getQueryParamsFromUrl,
  getStatusGroup,
  getURLSearchParams,
  isJSONString,
  replaceNumberCharByPath,
  safeJSONParse,
  searchConfigData,
  stringSplice,
  strip_empty_properties,
  urlParse,
  utf8Encode
} from './tools'

describe('tools legacy helpers', () => {
  it('should validate and parse JSON strings', () => {
    expect(isJSONString('{"a":1}')).toBeTrue()
    expect(isJSONString('{')).toBeFalse()
    expect(safeJSONParse('{"a":1}')).toEqual({ a: 1 })
    expect(safeJSONParse('{')).toBeFalse()
  })

  it('should strip empty properties and extract config data', () => {
    expect(
      strip_empty_properties({
        a: 1,
        b: null,
        c: undefined,
        d: false
      })
    ).toEqual({
      a: 1,
      d: false
    })

    const payload = {
      value: 1,
      $option: { sampleRate: 100 }
    }

    expect(searchConfigData(payload)).toEqual({ sampleRate: 100 })
    expect(payload).toEqual({ value: 1 })
  })

  it('should encode strings to utf8 and base64', () => {
    expect(utf8Encode('abc')).toBe('abc')
    expect(base64Encode('test')).toBe('dGVzdA==')
  })

  it('should group paths and parse urls', () => {
    expect(replaceNumberCharByPath('/orders/123/items/456/')).toBe('/orders/?/items/?')

    const parsed = urlParse('https://user:pass@example.com:8080/path?a=1#hash')
    expect(parsed.getParse()).toEqual(
      jasmine.objectContaining({
        Protocol: 'https',
        Host: 'example.com',
        Port: '8080',
        Path: '/path',
        QueryString: 'a=1',
        Origin: 'https://example.com:8080'
      })
    )
    expect(parsed.getUrl()).toBe('https://example.com:8080/path?a=1')
  })

  it('should parse search params from query strings and urls', () => {
    expect(getURLSearchParams('?a=1&b=hello%20world')).toEqual({
      a: '1',
      b: 'hello world'
    })
    expect(getQueryParamsFromUrl('https://example.com/path?a=1&b=2')).toEqual({
      a: '1',
      b: '2'
    })
  })

  it('should support string splicing and status groups', () => {
    expect(stringSplice('a=1&b=2&c=3', 'b', '&', '')).toBe('2')
    expect(stringSplice('', 'b', '&', '')).toBe('')
    expect(getStatusGroup(200)).toBe('2xx')
    expect(getStatusGroup(0)).toBeUndefined()
    expect(getStatusGroup(undefined)).toBeUndefined()
  })

  it('should execute queued tasks one by one', () => {
    const queue = autoExeQueue()
    const calls = []
    const first = {
      start: () => {
        calls.push('first')
        queue.close()
      }
    }
    const second = {
      start: () => {
        calls.push('second')
        queue.close()
      }
    }

    queue.enqueue(first)
    queue.enqueue(second)

    expect(calls).toEqual(['first', 'second'])
    expect(queue.items).toEqual([])
    expect(queue.isRun).toBeFalse()
  })
})
