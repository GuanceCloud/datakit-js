import {
  createLock,
  LOCK_RETRY_DELAY,
  processSessionStoreOperations
} from './sessionStoreOperations'
import { getExpiredSessionState } from './sessionState'

describe('sessionStoreOperations', () => {
  const now = new Date('2024-01-01T00:00:00.000Z')

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(now)
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should persist processed sessions when locking is disabled', () => {
    const persistedSessions = []
    const after = jasmine.createSpy('after')
    const sessionStoreStrategy = {
      isLockEnabled: false,
      retrieveSession: jasmine.createSpy('retrieveSession').and.returnValue({
        id: 'initial'
      }),
      persistSession: jasmine
        .createSpy('persistSession')
        .and.callFake((session) => persistedSessions.push(session)),
      expireSession: jasmine.createSpy('expireSession')
    }

    processSessionStoreOperations(
      {
        process: (session) => ({ ...session, id: 'updated' }),
        after
      },
      sessionStoreStrategy
    )

    expect(sessionStoreStrategy.expireSession).not.toHaveBeenCalled()
    expect(sessionStoreStrategy.persistSession).toHaveBeenCalledTimes(1)
    expect(persistedSessions[0]).toEqual(
      jasmine.objectContaining({
        id: 'updated',
        expire: String(now.getTime() + 15 * 60 * 1000)
      })
    )
    expect(after).toHaveBeenCalledWith(persistedSessions[0])
  })

  it('should expire sessions instead of persisting them when they are expired', () => {
    const sessionStoreStrategy = {
      isLockEnabled: false,
      retrieveSession: jasmine.createSpy('retrieveSession').and.returnValue({
        id: 'initial'
      }),
      persistSession: jasmine.createSpy('persistSession'),
      expireSession: jasmine.createSpy('expireSession')
    }

    processSessionStoreOperations(
      {
        process: () => getExpiredSessionState()
      },
      sessionStoreStrategy
    )

    expect(sessionStoreStrategy.expireSession).toHaveBeenCalledTimes(1)
    expect(sessionStoreStrategy.persistSession).not.toHaveBeenCalled()
  })

  it('should retry later when a valid lock is already held', () => {
    let currentSession = { id: 'initial', lock: `busy--${now.getTime()}` }
    const persistSession = jasmine.createSpy('persistSession').and.callFake(
      (session) => {
        currentSession = session
      }
    )
    const after = jasmine.createSpy('after')
    const sessionStoreStrategy = {
      isLockEnabled: true,
      retrieveSession: () => currentSession,
      persistSession,
      expireSession: jasmine.createSpy('expireSession')
    }

    processSessionStoreOperations(
      {
        process: (session) => ({ ...session, id: 'updated' }),
        after
      },
      sessionStoreStrategy
    )

    expect(persistSession).not.toHaveBeenCalled()
    expect(after).not.toHaveBeenCalled()

    currentSession = { id: 'initial' }
    jasmine.clock().tick(LOCK_RETRY_DELAY)

    expect(persistSession).toHaveBeenCalled()
    expect(after).toHaveBeenCalledWith(
      jasmine.objectContaining({
        id: 'updated'
      })
    )
  })

  it('should process buffered operations in order', () => {
    const calls = []
    let currentSession = { id: 'initial' }
    const sessionStoreStrategy = {
      isLockEnabled: false,
      retrieveSession: () => currentSession,
      persistSession: jasmine.createSpy('persistSession').and.callFake(
        (session) => {
          currentSession = session
        }
      ),
      expireSession: jasmine.createSpy('expireSession')
    }

    processSessionStoreOperations(
      {
        process: (session) => {
          calls.push('first')
          processSessionStoreOperations(
            {
              process: (bufferedSession) => {
                calls.push('second')
                return { ...bufferedSession, second: true }
              }
            },
            sessionStoreStrategy
          )
          return { ...session, first: true }
        }
      },
      sessionStoreStrategy
    )

    expect(calls).toEqual(['first', 'second'])
    expect(currentSession).toEqual(
      jasmine.objectContaining({
        id: 'initial',
        first: true,
        second: true
      })
    )
  })

  it('should create lock values with the uuid and timestamp format', () => {
    expect(createLock()).toMatch(
      /^[0-9a-f-]+--1704067200000$/
    )
  })
})
