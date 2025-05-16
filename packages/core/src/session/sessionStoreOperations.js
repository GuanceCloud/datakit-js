import { setTimeout } from '../helper/timer'
import { UUID, assign } from '../helper/tools'
import {
  expandSessionState,
  isSessionInExpiredState,
  isSessionInNotStartedState
} from './sessionState'

export const LOCK_RETRY_DELAY = 10
export const LOCK_MAX_TRIES = 100
const bufferedOperations = []
let ongoingOperations

export function processSessionStoreOperations(
  operations,
  sessionStoreStrategy,
  numberOfRetries = 0
) {
  const { isLockEnabled, persistSession, expireSession } = sessionStoreStrategy
  const persistWithLock = function (session) {
    return persistSession(assign({}, session, { lock: currentLock }))
  }
  const retrieveStore = function () {
    const session = sessionStoreStrategy.retrieveSession()
    const lock = session.lock
    if (session.lock) {
      delete session.lock
    }

    return {
      session,
      lock
    }
  }

  if (!ongoingOperations) {
    ongoingOperations = operations
  }
  if (operations !== ongoingOperations) {
    bufferedOperations.push(operations)
    return
  }
  if (isLockEnabled && numberOfRetries >= LOCK_MAX_TRIES) {
    next(sessionStoreStrategy)
    return
  }
  let currentLock
  let currentStore = retrieveStore()
  if (isLockEnabled) {
    // if someone has lock, retry later
    if (currentStore.lock) {
      retryLater(operations, sessionStoreStrategy, numberOfRetries)
      return
    }
    // acquire lock
    currentLock = UUID()
    persistWithLock(currentStore.session)
    // if lock is not acquired, retry later
    currentStore = retrieveStore()
    if (currentStore.lock !== currentLock) {
      retryLater(operations, sessionStoreStrategy, numberOfRetries)
      return
    }
  }
  let processedSession = operations.process(currentStore.session)
  if (isLockEnabled) {
    // if lock corrupted after process, retry later
    currentStore = retrieveStore()
    if (currentStore.lock !== currentLock) {
      retryLater(operations, sessionStoreStrategy, numberOfRetries)
      return
    }
  }
  if (processedSession) {
    if (isSessionInExpiredState(processedSession)) {
      expireSession()
    } else {
      expandSessionState(processedSession)
      isLockEnabled
        ? persistWithLock(processedSession)
        : persistSession(processedSession)
    }
  }
  if (isLockEnabled) {
    // correctly handle lock around expiration would require to handle this case properly at several levels
    // since we don't have evidence of lock issues around expiration, let's just not do the corruption check for it
    if (!(processedSession && isSessionInExpiredState(processedSession))) {
      // if lock corrupted after persist, retry later
      currentStore = retrieveStore()
      if (currentStore.lock !== currentLock) {
        retryLater(operations, sessionStoreStrategy, numberOfRetries)
        return
      }
      persistSession(currentStore.session)
      processedSession = currentStore.session
    }
  }
  // call after even if session is not persisted in order to perform operations on
  // up-to-date session state value => the value could have been modified by another tab
  if (operations.after) {
    operations.after(processedSession || currentStore.session)
  }
  next(sessionStoreStrategy)
}

function retryLater(operations, sessionStore, currentNumberOfRetries) {
  setTimeout(function () {
    processSessionStoreOperations(
      operations,
      sessionStore,
      currentNumberOfRetries + 1
    )
  }, LOCK_RETRY_DELAY)
}

function next(sessionStore) {
  ongoingOperations = undefined
  const nextOperations = bufferedOperations.shift()
  if (nextOperations) {
    processSessionStoreOperations(nextOperations, sessionStore)
  }
}
