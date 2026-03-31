import {
  buildCookieOptions,
  initCookieStrategy,
  selectCookieStrategy
} from './sessionInCookie'
import { SessionPersistence, SESSION_STORE_KEY } from './sessionConstants'
import { EXPIRED } from './sessionState'
import { getCookie, getCurrentSite, resetInitCookies } from '../browser/cookie'

describe('sessionInCookie', () => {
  afterEach(() => {
    resetInitCookies()
  })

  it('should build cookie options from the init configuration', () => {
    expect(buildCookieOptions({})).toEqual({
      secure: false,
      crossSite: false,
      partitioned: false
    })

    expect(
      buildCookieOptions({
        useSecureSessionCookie: true,
        useCrossSiteSessionCookie: true,
        usePartitionedCrossSiteSessionCookie: true
      })
    ).toEqual({
      secure: true,
      crossSite: true,
      partitioned: true
    })
  })

  it('should add the current site as cookie domain when tracking across subdomains', () => {
    expect(
      buildCookieOptions({
        trackSessionAcrossSubdomains: true
      })
    ).toEqual({
      secure: false,
      crossSite: false,
      partitioned: false,
      domain: getCurrentSite()
    })
  })

  it('should select the cookie strategy when cookies are authorized', () => {
    const result = selectCookieStrategy({})

    expect(result.type).toBe(SessionPersistence.COOKIE)
    expect(result.cookieOptions).toEqual({
      secure: false,
      crossSite: false,
      partitioned: false
    })
  })

  it('should persist, retrieve and expire sessions through cookies', () => {
    const cookieOptions = {
      secure: false,
      crossSite: false,
      partitioned: false
    }
    const strategy = initCookieStrategy(cookieOptions)
    const session = {
      id: 'cookie-session',
      created: '1700000000000'
    }

    strategy.persistSession(session)
    expect(getCookie(SESSION_STORE_KEY, cookieOptions)).toBe(
      'id=cookie-session&created=1700000000000'
    )
    expect(strategy.retrieveSession()).toEqual(session)

    strategy.expireSession()
    expect(strategy.retrieveSession()).toEqual({ isExpired: EXPIRED })
  })

  it('should expose the browser-dependent lock flag on the cookie strategy', () => {
    const strategy = initCookieStrategy({
      secure: false,
      crossSite: false,
      partitioned: false
    })

    expect(typeof strategy.isLockEnabled).toBe('boolean')
  })
})
