import {
  findCommaSeparatedValue,
  UUID,
  ONE_SECOND,
  ONE_MINUTE,
  findCommaSeparatedValues
} from '../helper/tools'

function getCookieName(name, options) {
  return `${name}_${options && options.crossSite ? 'cs1' : 'cs0'}_${
    options && options.domain ? 'd1' : 'd0'
  }_${options && options.secure ? 'sec1' : 'sec0'}_${
    options && options.partitioned ? 'part1' : 'part0'
  }`
}
export function setCookie(name, value, expireDelay, options) {
  var date = new Date()
  date.setTime(date.getTime() + expireDelay)
  var expires = 'expires=' + date.toUTCString()
  var sameSite = options && options.crossSite ? 'none' : 'strict'
  var domain = options && options.domain ? ';domain=' + options.domain : ''
  var secure = options && options.secure ? ';secure' : ''
  var partitioned = options && options.partitioned ? ';partitioned' : ''

  document.cookie =
    getCookieName(name, options) +
    '=' +
    value +
    ';' +
    expires +
    ';path=/;samesite=' +
    sameSite +
    domain +
    secure +
    partitioned
}

export function getCookie(name, options) {
  return findCommaSeparatedValue(document.cookie, getCookieName(name, options))
}
var initCookieParsed
/**
 * Returns a cached value of the cookie. Use this during SDK initialization (and whenever possible)
 * to avoid accessing document.cookie multiple times.
 */
export function getInitCookie(name) {
  if (!initCookieParsed) {
    initCookieParsed = findCommaSeparatedValues(document.cookie)
  }
  return initCookieParsed.get(name)
}

export function resetInitCookies() {
  initCookieParsed = undefined
}
export function deleteCookie(name, options) {
  setCookie(name, '', 0, options)
}

export function areCookiesAuthorized(options) {
  if (document.cookie === undefined || document.cookie === null) {
    return false
  }
  try {
    // Use a unique cookie name to avoid issues when the SDK is initialized multiple times during
    // the test cookie lifetime
    var testCookieName = `gc_cookie_test_${UUID()}`
    var testCookieValue = 'test'
    setCookie(testCookieName, testCookieValue, ONE_MINUTE, options)
    const isCookieCorrectlySet =
      getCookie(testCookieName, options) === testCookieValue
    deleteCookie(testCookieName, options)
    return isCookieCorrectlySet
  } catch (error) {
    return false
  }
}

/**
 * No API to retrieve it, number of levels for subdomain and suffix are unknown
 * strategy: find the minimal domain on which cookies are allowed to be set
 * https://web.dev/same-site-same-origin/#site
 */
var getCurrentSiteCache
export function getCurrentSite() {
  if (getCurrentSiteCache === undefined) {
    // Use a unique cookie name to avoid issues when the SDK is initialized multiple times during
    // the test cookie lifetime
    const testCookieName = `gc_site_test_${UUID()}`
    const testCookieValue = 'test'
    const domainLevels = window.location.hostname.split('.')
    let candidateDomain = domainLevels.pop()
    while (
      domainLevels.length &&
      !getCookie(testCookieName, {
        domain: candidateDomain
      })
    ) {
      candidateDomain = `${domainLevels.pop()}.${candidateDomain}`
      setCookie(testCookieName, testCookieValue, ONE_SECOND, {
        domain: candidateDomain
      })
    }
    deleteCookie(testCookieName, { domain: candidateDomain })
    getCurrentSiteCache = candidateDomain
  }
  return getCurrentSiteCache
}
