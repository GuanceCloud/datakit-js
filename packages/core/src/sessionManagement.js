import { cacheCookieAccess, COOKIE_ACCESS_DELAY } from './cookie'
import { Observable } from './helper/observable'
import {
  ONE_MINUTE,
  ONE_HOUR,
  throttle,
  UUID,
  isEmptyObject,
  objectEntries,
  addEventListener,
  addEventListeners,
  each
} from './helper/tools'
import { DOM_EVENT } from './helper/enums'

export var SESSION_COOKIE_NAME = '_dataflux_s'
export var SESSION_EXPIRATION_DELAY = 15 * ONE_MINUTE
export var SESSION_TIME_OUT_DELAY = 4 * ONE_HOUR
export var VISIBILITY_CHECK_DELAY = ONE_MINUTE
export var ANONYMOUS_ID_COOKIE_NAME = '_dataflulx_an_id'
export var ANONYMOUS_ID_EXPIRATION = 60 * 24 * ONE_HOUR
function cacheAnonymousID(options) {
  var anonymousCookie = cacheCookieAccess(ANONYMOUS_ID_COOKIE_NAME, options)
  var anonymouseId = anonymousCookie.get()
  if (!anonymouseId) {
    anonymousCookie.set(UUID(), ANONYMOUS_ID_EXPIRATION)
  }
  return anonymousCookie
}
/**
 * Limit access to cookie to avoid performance issues
 */
export function startSessionManagement(
  options,
  productKey,
  computeSessionState
) {
  var anonymousCookie = cacheAnonymousID(options)
  var sessionCookie = cacheCookieAccess(SESSION_COOKIE_NAME, options)
  var renewObservable = new Observable()
  var currentSession = retrieveActiveSession(sessionCookie)
  var currentSessionId = currentSession.id
  var expandOrRenewSession = throttle(function () {
    sessionCookie.clearCache()
    var session = retrieveActiveSession(sessionCookie)
    var state = computeSessionState(session[productKey])
    session[productKey] = state.trackingType
    if (state.isTracked && !session.id) {
      session.id = UUID()
      session.created = String(Date.now())
    }
    // save changes and expand session duration
    persistSession(session, sessionCookie)

    // If the session id has changed, notify that the session has been renewed
    if (state.isTracked && currentSessionId !== session.id) {
      currentSessionId = session.id
      renewObservable.notify()
    }
  }, COOKIE_ACCESS_DELAY)

  var expandSession = function () {
    sessionCookie.clearCache()
    var session = retrieveActiveSession(sessionCookie)
    persistSession(session, sessionCookie)
  }

  expandOrRenewSession()
  trackActivity(expandOrRenewSession)
  trackVisibility(expandSession)

  return {
    getAnonymousID: function () {
      return anonymousCookie.get()
    },
    getId: function () {
      // ?????????debug id
      var session = retrieveActiveSession(sessionCookie)
      return session.did || session.id
    },
    getTrackingType: function () {
      return retrieveActiveSession(sessionCookie)[productKey]
    },
    getDebugSession: function () {
      var session = retrieveActiveSession(sessionCookie)
      if (isEmptyObject(session) || !session.did) {
        return {}
      }
      return {
        id: session.did,
        created: session.dcreated
      }
    },
    addDebugSession: function (id, created) {
      var session = retrieveActiveSession(sessionCookie)
      if (!isEmptyObject(session)) {
        session.did = id || UUID
        session.dcreated = created || String(Date.now())
        persistSession(session, sessionCookie)
      }
    },
    clearDebugSession: function () {
      var session = retrieveActiveSession(sessionCookie)
      var newSession = {}
      each(objectEntries(session), function (item) {
        if (item[0] !== 'did' && item[0] !== 'dcreated') {
          newSession[item[0]] = item[1]
        }
      })
      persistSession(newSession, sessionCookie)
    },
    renewObservable: renewObservable
  }
}

var SESSION_ENTRY_REGEXP = /^([a-z]+)=([a-z0-9-]+)$/

var SESSION_ENTRY_SEPARATOR = '&'
export function isValidSessionString(sessionString) {
  return (
    sessionString !== undefined &&
    (sessionString.indexOf(SESSION_ENTRY_SEPARATOR) !== -1 ||
      SESSION_ENTRY_REGEXP.test(sessionString))
  )
}

function retrieveActiveSession(sessionCookie) {
  var session = retrieveSession(sessionCookie)
  if (isActiveSession(session)) {
    return session
  }
  clearSession(sessionCookie)
  return {}
}

function isActiveSession(session) {
  return (
    (session.created === undefined ||
      Date.now() - Number(session.created) < SESSION_TIME_OUT_DELAY) &&
    (session.expire === undefined || Date.now() < Number(session.expire))
  )
}

function retrieveSession(sessionCookie) {
  var sessionString = sessionCookie.get()
  var session = {}
  if (isValidSessionString(sessionString)) {
    each(sessionString.split(SESSION_ENTRY_SEPARATOR), function (entry) {
      var matches = SESSION_ENTRY_REGEXP.exec(entry)
      if (matches !== null) {
        var key = matches[1]
        var value = matches[2]
        session[key] = value
      }
    })
  }
  return session
}

export function persistSession(session, cookie) {
  if (isEmptyObject(session)) {
    clearSession(cookie)
    return
  }
  session.expire = String(Date.now() + SESSION_EXPIRATION_DELAY)
  var cookieArray = []
  each(objectEntries(session), function (item) {
    cookieArray.push(item[0] + '=' + item[1])
  })
  var cookieString = cookieArray.join(SESSION_ENTRY_SEPARATOR)
  cookie.set(cookieString, SESSION_EXPIRATION_DELAY)
}

function clearSession(cookie) {
  cookie.set('', 0)
}

export function stopSessionManagement() {
  each(stopCallbacks, function (e) {
    e()
  })

  stopCallbacks = []
}

var stopCallbacks = []

export function trackActivity(expandOrRenewSession) {
  var listeners = addEventListeners(
    window,
    [
      DOM_EVENT.CLICK,
      DOM_EVENT.TOUCH_START,
      DOM_EVENT.KEY_DOWN,
      DOM_EVENT.SCROLL
    ],
    expandOrRenewSession,
    { capture: true, passive: true }
  )
  stopCallbacks.push(listeners.stop)
}

function trackVisibility(expandSession) {
  var expandSessionWhenVisible = function () {
    if (document.visibilityState === 'visible') {
      expandSession()
    }
  }

  var listener = addEventListener(
    document,
    DOM_EVENT.VISIBILITY_CHANGE,
    expandSessionWhenVisible
  )
  stopCallbacks.push(listener.stop)

  var visibilityCheckInterval = window.setInterval(
    expandSessionWhenVisible,
    VISIBILITY_CHECK_DELAY
  )
  stopCallbacks.push(function () {
    clearInterval(visibilityCheckInterval)
  })
}
