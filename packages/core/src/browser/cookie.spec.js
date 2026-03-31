import {
  areCookiesAuthorized,
  deleteCookie,
  getCookie,
  getCurrentSite,
  getInitCookie,
  resetInitCookies,
  setCookie
} from './cookie'

describe('cookie helpers', () => {
  afterEach(() => {
    deleteCookie('spec_cookie')
    deleteCookie('spec_init_cookie')
    resetInitCookies()
  })

  it('should set, get, and delete cookies with the encoded option suffix', () => {
    setCookie('spec_cookie', 'value', 60 * 1000)

    expect(getCookie('spec_cookie')).toBe('value')

    deleteCookie('spec_cookie')

    expect(getCookie('spec_cookie')).toBeUndefined()
  })

  it('should cache init cookies until reset', () => {
    document.cookie = 'spec_init_cookie=value-one'

    expect(getInitCookie('spec_init_cookie')).toBe('value-one')

    document.cookie = 'spec_init_cookie=value-two'
    expect(getInitCookie('spec_init_cookie')).toBe('value-one')

    resetInitCookies()
    expect(getInitCookie('spec_init_cookie')).toBe('value-two')
  })

  it('should report cookie support when cookies can be written', () => {
    expect(areCookiesAuthorized()).toBeTrue()
  })

  it('should compute the current site from the hostname', () => {
    expect(getCurrentSite()).toBe('localhost')
  })
})
