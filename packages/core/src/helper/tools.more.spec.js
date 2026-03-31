import { display } from './display'
import {
  Browser,
  cssEscape,
  detectBrowser,
  endsWith,
  hashCode,
  isPercentage,
  mapValues,
  matchList,
  msToNs,
  performDraw,
  removeDuplicates,
  safeTruncate,
  startsWith,
  throttle,
  toServerDuration
} from './tools'

describe('tools additional helpers', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should throttle leading and trailing executions', () => {
    const spy = jasmine.createSpy('spy')
    const throttled = throttle(spy, 100)

    throttled.throttled('first')
    throttled.throttled('second')

    expect(spy.calls.allArgs()).toEqual([['first']])

    jasmine.clock().tick(100)

    expect(spy.calls.allArgs()).toEqual([['first'], ['second']])
  })

  it('should cancel pending throttled executions', () => {
    const spy = jasmine.createSpy('spy')
    const throttled = throttle(spy, 100, { leading: false })

    throttled.throttled('first')
    throttled.cancel()
    jasmine.clock().tick(100)

    expect(spy).not.toHaveBeenCalled()
  })

  it('should match values against functions, regexes and strings and report matcher errors', () => {
    spyOn(display, 'error')

    expect(
      matchList(
        [
          () => {
            throw new Error('bad matcher')
          },
          /hello/,
          'world'
        ],
        'hello'
      )
    ).toBeTrue()
    expect(matchList(['https://example.com'], 'https://example.com/path', true)).toBeTrue()
    expect(display.error).toHaveBeenCalled()
  })

  it('should escape css selectors and preserve surrogate pairs when truncating', () => {
    expect(cssEscape('a b')).toBe('a\\ b')
    expect(safeTruncate('ab😀', 3)).toBe('ab😀')
  })

  it('should detect browsers from browser-like objects', () => {
    expect(
      detectBrowser({
        chrome: {},
        navigator: { userAgent: 'Chrome/120.0', vendor: 'Google' },
        document: {}
      })
    ).toBe(Browser.CHROMIUM)
    expect(
      detectBrowser({
        navigator: {
          userAgent: 'Version/17.0 Safari/605.1.15',
          vendor: 'Apple Computer, Inc.'
        },
        document: {}
      })
    ).toBe(Browser.SAFARI)
    expect(
      detectBrowser({
        navigator: { userAgent: 'Mozilla/5.0', vendor: '' },
        document: { documentMode: 11 }
      })
    ).toBe(Browser.IE)
  })

  it('should cover numeric and string helpers', () => {
    expect(performDraw(0)).toBeFalse()
    expect(msToNs(1.234)).toBe(1234000)
    expect(toServerDuration(1.5)).toBe(1500000)
    expect(mapValues({ a: 1, b: 2 }, (value) => value * 2)).toEqual({
      a: 2,
      b: 4
    })
    expect(isPercentage(50)).toBeTrue()
    expect(isPercentage(150)).toBeFalse()
    expect(startsWith('browser-sdk', 'browser')).toBeTrue()
    expect(endsWith('browser-sdk', 'sdk')).toBeTrue()
    expect(removeDuplicates(['a', 'b', 'a'])).toEqual(['a', 'b'])
    expect(hashCode('abc')).not.toBe(0)
  })
})
