import { SessionPersistence } from '@cloudcare/browser-core'
import {
  ANONYMOUS_ID_EXPIRATION,
  startCacheUsrCache,
  USR_ID_COOKIE_NAME
} from './index'

describe('domain/usr/index', () => {
  let originalCookie

  beforeEach(() => {
    originalCookie = document.cookie
    localStorage.removeItem(USR_ID_COOKIE_NAME)
    document.cookie =
      USR_ID_COOKIE_NAME + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
  })

  afterEach(() => {
    localStorage.removeItem(USR_ID_COOKIE_NAME)
    document.cookie =
      USR_ID_COOKIE_NAME + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/'
    if (originalCookie) {
      document.cookie = originalCookie
    }
  })

  it('should expose a noop cache when no session store strategy is configured', () => {
    const cache = startCacheUsrCache({})

    expect(cache.getId()).toBeUndefined()
    expect(ANONYMOUS_ID_EXPIRATION).toBeGreaterThan(0)
  })

  it('should persist a generated id in localStorage', () => {
    const cache = startCacheUsrCache({
      sessionStoreStrategyType: {
        type: SessionPersistence.LOCAL_STORAGE
      }
    })

    expect(cache.getId()).toEqual(localStorage.getItem(USR_ID_COOKIE_NAME))
    expect(cache.getId()).toEqual(startCacheUsrCache({
      sessionStoreStrategyType: {
        type: SessionPersistence.LOCAL_STORAGE
      }
    }).getId())
  })

  it('should persist a generated id in cookies', () => {
    const cache = startCacheUsrCache({
      sessionStoreStrategyType: {
        type: SessionPersistence.COOKIE,
        cookieOptions: {}
      }
    })

    expect(cache.getId()).toBeTruthy()
    expect(document.cookie).toContain(USR_ID_COOKIE_NAME)
    expect(document.cookie).toContain(cache.getId())
  })
})
