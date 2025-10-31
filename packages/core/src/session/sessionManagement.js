import { Observable } from '../helper/observable'
import { createValueHistory } from '../helper/valueHistory'
import { relativeNow, clocksOrigin, ONE_MINUTE } from '../helper/tools'
import { DOM_EVENT } from '../helper/enums'
import {
  addEventListener,
  addEventListeners
} from '../browser/addEventListener'
import { clearInterval, setInterval } from '../helper/timer'
import { SESSION_TIME_OUT_DELAY, SESSION_NOT_TRACKED } from './sessionConstants'
import { startSessionStore } from './sessionStore'

export const VISIBILITY_CHECK_DELAY = ONE_MINUTE
const SESSION_CONTEXT_TIMEOUT_DELAY = SESSION_TIME_OUT_DELAY
let stopCallbacks = []

export function startSessionManager(
  configuration,
  productKey,
  computeSessionState
) {
  const renewObservable = new Observable()
  const expireObservable = new Observable()

  const sessionStore = startSessionStore(
    configuration.sessionStoreStrategyType,
    productKey,
    computeSessionState
  )
  stopCallbacks.push(function () {
    return sessionStore.stop()
  })

  const sessionContextHistory = createValueHistory({
    expireDelay: SESSION_CONTEXT_TIMEOUT_DELAY
  })
  stopCallbacks.push(function () {
    return sessionContextHistory.stop()
  })

  sessionStore.renewObservable.subscribe(function () {
    sessionContextHistory.add(buildSessionContext(), relativeNow())
    renewObservable.notify()
  })
  sessionStore.expireObservable.subscribe(function () {
    expireObservable.notify()
    sessionContextHistory.closeActive(relativeNow())
  })

  // manager is started.
  sessionStore.expandOrRenewSession()
  sessionContextHistory.add(buildSessionContext(), clocksOrigin().relative)

  trackActivity(function () {
    sessionStore.expandOrRenewSession()
  })
  trackVisibility(function () {
    return sessionStore.expandSession()
  })
  trackResume(function () {
    sessionStore.restartSession()
  })

  function buildSessionContext() {
    const session = sessionStore.getSession()
    if (!session) {
      return {
        id: 'invalid',
        trackingType: SESSION_NOT_TRACKED,
        isSessionForced: false,
        hasError: false
      }
    }
    return {
      id: session.id,
      trackingType: session[productKey],
      hasError: !!session.hasError,
      isSessionForced: !!session.forcedSession
    }
  }

  return {
    findSession: function (startTime, options) {
      return sessionContextHistory.find(startTime, options)
    },
    renewObservable,
    expireObservable,
    sessionStateUpdateObservable: sessionStore.sessionStateUpdateObservable,
    expire: sessionStore.expire,
    updateSessionState: sessionStore.updateSessionState
  }
}

export function stopSessionManager() {
  stopCallbacks.forEach(function (e) {
    e()
  })
  stopCallbacks = []
}

function trackActivity(expandOrRenewSession) {
  const { stop } = addEventListeners(
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
  stopCallbacks.push(stop)
}

function trackVisibility(expandSession) {
  const expandSessionWhenVisible = function () {
    if (document.visibilityState === 'visible') {
      expandSession()
    }
  }

  const { stop } = addEventListener(
    document,
    DOM_EVENT.VISIBILITY_CHANGE,
    expandSessionWhenVisible
  )
  stopCallbacks.push(stop)

  const visibilityCheckInterval = setInterval(
    expandSessionWhenVisible,
    VISIBILITY_CHECK_DELAY
  )
  stopCallbacks.push(function () {
    clearInterval(visibilityCheckInterval)
  })
}

function trackResume(cb) {
  const { stop } = addEventListener(window, DOM_EVENT.RESUME, cb, {
    capture: true
  })
  stopCallbacks.push(stop)
}
