import { clearInterval, setInterval } from '../helper/timer'
import { Observable } from '../helper/observable'
import { display } from '../helper/display'
import { ONE_SECOND, dateNow, throttle, UUID, assign } from '../helper/tools'
import { selectCookieStrategy, initCookieStrategy } from './sessionInCookie'
import {
  getExpiredSessionState,
  isSessionInExpiredState,
  isSessionInNotStartedState,
  isSessionStarted
} from './sessionState'
import {
  initLocalStorageStrategy,
  selectLocalStorageStrategy
} from './sessionInLocalStorage'
import { processSessionStoreOperations } from './sessionStoreOperations'
import { SessionPersistence } from './sessionConstants'

/**
 * Every second, the storage will be polled to check for any change that can occur
 * to the session state in another browser tab, or another window.
 * This value has been determined from our previous cookie-only implementation.
 */
export const STORAGE_POLL_DELAY = ONE_SECOND

/**
 * Checks if cookies are available as the preferred storage
 * Else, checks if LocalStorage is allowed and available
 */
export function selectSessionStoreStrategyType(initConfiguration) {
  switch (initConfiguration.sessionPersistence) {
    case SessionPersistence.COOKIE:
      return selectCookieStrategy(initConfiguration)

    case SessionPersistence.LOCAL_STORAGE:
      return selectLocalStorageStrategy()

    case undefined: {
      let sessionStoreStrategyType = selectCookieStrategy(initConfiguration)
      if (
        !sessionStoreStrategyType &&
        initConfiguration.allowFallbackToLocalStorage
      ) {
        sessionStoreStrategyType = selectLocalStorageStrategy()
      }
      return sessionStoreStrategyType
    }

    default:
      display.error(
        `Invalid session persistence '${String(
          initConfiguration.sessionPersistence
        )}'`
      )
  }
}

/**
 * Different session concepts:
 * - tracked, the session has an id and is updated along the user navigation
 * - not tracked, the session does not have an id but it is updated along the user navigation
 * - inactive, no session in store or session expired, waiting for a renew session
 */
export function startSessionStore(
  sessionStoreStrategyType,
  productKey,
  computeSessionState
) {
  const renewObservable = new Observable()
  const expireObservable = new Observable()
  const sessionStateUpdateObservable = new Observable()
  const sessionStoreStrategy =
    sessionStoreStrategyType.type === SessionPersistence.COOKIE
      ? initCookieStrategy(sessionStoreStrategyType.cookieOptions)
      : initLocalStorageStrategy()
  const { expireSession } = sessionStoreStrategy

  const watchSessionTimeoutId = setInterval(watchSession, STORAGE_POLL_DELAY)
  let sessionCache

  startSession()

  const {
    throttled: throttledExpandOrRenewSession,
    cancel: cancelExpandOrRenewSession
  } = throttle(function () {
    processSessionStoreOperations(
      {
        process: function (sessionState) {
          if (isSessionInNotStartedState(sessionState)) {
            return
          }

          const synchronizedSession = synchronizeSession(sessionState)
          expandOrRenewSessionState(synchronizedSession)
          return synchronizedSession
        },
        after: function (sessionState) {
          if (isSessionStarted(sessionState) && !hasSessionInCache()) {
            renewSessionInCache(sessionState)
          }
          sessionCache = sessionState
        }
      },
      sessionStoreStrategy
    )
  }, STORAGE_POLL_DELAY)

  function expandSession() {
    processSessionStoreOperations(
      {
        process: function (sessionState) {
          return hasSessionInCache()
            ? synchronizeSession(sessionState)
            : undefined
        }
      },
      sessionStoreStrategy
    )
  }

  /**
   * allows two behaviors:
   * - if the session is active, synchronize the session cache without updating the session store
   * - if the session is not active, clear the session store and expire the session cache
   */
  function watchSession() {
    processSessionStoreOperations(
      {
        process: function (sessionState) {
          return isSessionInExpiredState(sessionState)
            ? getExpiredSessionState()
            : undefined
        },
        after: synchronizeSession
      },
      sessionStoreStrategy
    )
  }

  function synchronizeSession(sessionState) {
    if (isSessionInExpiredState(sessionState)) {
      sessionState = getExpiredSessionState()
    }
    if (hasSessionInCache()) {
      if (isSessionInCacheOutdated(sessionState)) {
        expireSessionInCache()
      } else {
        sessionStateUpdateObservable.notify({
          previousState: sessionCache,
          newState: sessionState
        })
        sessionCache = sessionState
      }
    }
    return sessionState
  }

  function startSession() {
    processSessionStoreOperations(
      {
        process: function (sessionState) {
          if (isSessionInNotStartedState(sessionState)) {
            return getExpiredSessionState()
          }
        },
        after: function (sessionState) {
          sessionCache = sessionState
        }
      },
      sessionStoreStrategy
    )
  }

  function expandOrRenewSessionState(sessionState) {
    if (isSessionInNotStartedState(sessionState)) {
      return false
    }

    const { trackingType, isTracked } = computeSessionState(
      sessionState[productKey]
    )
    sessionState[productKey] = trackingType
    delete sessionState.isExpired
    if (isTracked && !sessionState.id) {
      sessionState.id = UUID()
      sessionState.created = String(dateNow())
    }
  }

  function hasSessionInCache() {
    return sessionCache[productKey] !== undefined
  }

  function isSessionInCacheOutdated(sessionState) {
    return (
      sessionCache.id !== sessionState.id ||
      sessionCache[productKey] !== sessionState[productKey]
    )
  }

  function expireSessionInCache() {
    sessionCache = getExpiredSessionState()
    expireObservable.notify()
  }

  function renewSessionInCache(sessionState) {
    sessionCache = sessionState
    renewObservable.notify()
  }

  function updateSessionState(partialSessionState) {
    processSessionStoreOperations(
      {
        process: function (sessionState) {
          return assign({}, sessionState, partialSessionState)
        },
        after: synchronizeSession
      },
      sessionStoreStrategy
    )
  }

  return {
    expandOrRenewSession: throttledExpandOrRenewSession,
    expandSession,
    getSession: function () {
      return sessionCache || {}
    },
    renewObservable,
    expireObservable,
    sessionStateUpdateObservable,
    restartSession: startSession,
    expire: function () {
      cancelExpandOrRenewSession()
      expireSession()
      synchronizeSession(getExpiredSessionState())
    },
    stop: function () {
      clearInterval(watchSessionTimeoutId)
    },
    updateSessionState
  }
}
