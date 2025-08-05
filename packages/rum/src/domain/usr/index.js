import {
  getCookie,
  setCookie,
  UUID,
  ONE_HOUR,
  SessionPersistence
} from '@cloudcare/browser-core'
export var USR_ID_COOKIE_NAME = '_gc_usr_id'
export var ANONYMOUS_ID_EXPIRATION = 60 * 24 * ONE_HOUR

function initUsrCookie(cookieOptions) {
  var usrCacheId = getCookie(USR_ID_COOKIE_NAME, cookieOptions)
  if (!usrCacheId) {
    usrCacheId = UUID()
    setCookie(
      USR_ID_COOKIE_NAME,
      usrCacheId,
      ANONYMOUS_ID_EXPIRATION,
      cookieOptions
    )
  }
  return usrCacheId
}
function initUsrLocalStorage() {
  var usrCacheId = localStorage.getItem(USR_ID_COOKIE_NAME)
  if (!usrCacheId) {
    usrCacheId = UUID()
    localStorage.setItem(USR_ID_COOKIE_NAME, usrCacheId)
  }
  return usrCacheId
}
export var startCacheUsrCache = function (configuration) {
  if (!configuration.sessionStoreStrategyType) return
  let usrCacheId
  if (
    configuration.sessionStoreStrategyType.type === SessionPersistence.COOKIE
  ) {
    usrCacheId = initUsrCookie(
      configuration.sessionStoreStrategyType.cookieOptions
    )
  } else {
    usrCacheId = initUsrLocalStorage()
  }

  return {
    getId: function () {
      return usrCacheId
    }
  }
}
