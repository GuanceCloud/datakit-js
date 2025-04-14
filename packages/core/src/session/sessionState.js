import { isEmptyObject, objectEntries, dateNow, map } from '../helper/tools'
import {
  SESSION_EXPIRATION_DELAY,
  SESSION_TIME_OUT_DELAY
} from './sessionConstants'

const SESSION_ENTRY_REGEXP = /^([a-zA-Z]+)=([a-z0-9-]+)$/
const SESSION_ENTRY_SEPARATOR = '&'

export const EXPIRED = '1'

export function getExpiredSessionState() {
  return {
    isExpired: EXPIRED
  }
}

export function isSessionInNotStartedState(session) {
  return isEmptyObject(session)
}

export function isSessionStarted(session) {
  return !isSessionInNotStartedState(session)
}

export function isSessionInExpiredState(session) {
  return session.isExpired !== undefined || !isActiveSession(session)
}

function isActiveSession(sessionState) {
  return (
    (sessionState.created === undefined ||
      dateNow() - Number(sessionState.created) < SESSION_TIME_OUT_DELAY) &&
    (sessionState.expire === undefined ||
      dateNow() < Number(sessionState.expire))
  )
}

export function expandSessionState(session) {
  session.expire = String(dateNow() + SESSION_EXPIRATION_DELAY)
}

export function toSessionString(session) {
  return map(objectEntries(session), function (item) {
    return item[0] + '=' + item[1]
  }).join(SESSION_ENTRY_SEPARATOR)
}

export function toSessionState(sessionString) {
  const session = {}
  if (isValidSessionString(sessionString)) {
    sessionString.split(SESSION_ENTRY_SEPARATOR).forEach(function (entry) {
      const matches = SESSION_ENTRY_REGEXP.exec(entry)
      if (matches !== null) {
        const [, key, value] = matches
        session[key] = value
      }
    })
  }
  return session
}

function isValidSessionString(sessionString) {
  return (
    !!sessionString &&
    (sessionString.indexOf(SESSION_ENTRY_SEPARATOR) !== -1 ||
      SESSION_ENTRY_REGEXP.test(sessionString))
  )
}
