import { UUID } from '../helper/tools'
import {
  toSessionString,
  toSessionState,
  getExpiredSessionState
} from './sessionState'

import { SESSION_STORE_KEY, SessionPersistence } from './sessionConstants'

const LOCAL_STORAGE_TEST_KEY = '_gc_test_'

export function selectLocalStorageStrategy() {
  try {
    const id = UUID()
    const testKey = `${LOCAL_STORAGE_TEST_KEY}${id}`
    localStorage.setItem(testKey, id)
    const retrievedId = localStorage.getItem(testKey)
    localStorage.removeItem(testKey)
    return id === retrievedId
      ? { type: SessionPersistence.LOCAL_STORAGE }
      : undefined
  } catch (e) {
    return undefined
  }
}

export function initLocalStorageStrategy() {
  return {
    isLockEnabled: false,
    persistSession: persistInLocalStorage,
    retrieveSession: retrieveSessionFromLocalStorage,
    expireSession: expireSessionFromLocalStorage
  }
}

function persistInLocalStorage(sessionState) {
  localStorage.setItem(SESSION_STORE_KEY, toSessionString(sessionState))
}

function retrieveSessionFromLocalStorage() {
  const sessionString = localStorage.getItem(SESSION_STORE_KEY)
  return toSessionState(sessionString)
}

function expireSessionFromLocalStorage() {
  persistInLocalStorage(getExpiredSessionState())
}
