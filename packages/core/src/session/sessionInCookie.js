import { isChromium } from '../helper/tools'
import {
  getCurrentSite,
  areCookiesAuthorized,
  getCookie,
  setCookie
} from '../browser/cookie'
import {
  SESSION_EXPIRATION_DELAY,
  SESSION_TIME_OUT_DELAY,
  SESSION_STORE_KEY,
  SessionPersistence
} from './sessionConstants'
import {
  toSessionString,
  toSessionState,
  getExpiredSessionState
} from './sessionState'

export function selectCookieStrategy(initConfiguration) {
  const cookieOptions = buildCookieOptions(initConfiguration)
  return areCookiesAuthorized(cookieOptions)
    ? { type: SessionPersistence.COOKIE, cookieOptions }
    : undefined
}

export function initCookieStrategy(cookieOptions) {
  const cookieStore = {
    /**
     * Lock strategy allows mitigating issues due to concurrent access to cookie.
     * This issue concerns only chromium browsers and enabling this on firefox increases cookie write failures.
     */
    isLockEnabled: isChromium(),
    persistSession: persistSessionCookie(cookieOptions),
    retrieveSession: retrieveSessionCookie(cookieOptions),
    expireSession: function () {
      return expireSessionCookie(cookieOptions)
    }
  }
  return cookieStore
}

function persistSessionCookie(options) {
  return function (session) {
    setCookie(
      SESSION_STORE_KEY,
      toSessionString(session),
      SESSION_EXPIRATION_DELAY,
      options
    )
  }
}

function expireSessionCookie(options) {
  setCookie(
    SESSION_STORE_KEY,
    toSessionString(getExpiredSessionState()),
    SESSION_TIME_OUT_DELAY,
    options
  )
}

function retrieveSessionCookie(options) {
  return function () {
    var sessionString = getCookie(SESSION_STORE_KEY, options)
    return toSessionState(sessionString)
  }
}

export function buildCookieOptions(initConfiguration) {
  const cookieOptions = {}

  cookieOptions.secure =
    !!initConfiguration.useSecureSessionCookie ||
    !!initConfiguration.usePartitionedCrossSiteSessionCookie ||
    !!initConfiguration.useCrossSiteSessionCookie
  cookieOptions.crossSite =
    !!initConfiguration.usePartitionedCrossSiteSessionCookie ||
    !!initConfiguration.useCrossSiteSessionCookie
  cookieOptions.partitioned =
    !!initConfiguration.usePartitionedCrossSiteSessionCookie

  if (initConfiguration.trackSessionAcrossSubdomains) {
    cookieOptions.domain = getCurrentSite()
  }

  return cookieOptions
}
