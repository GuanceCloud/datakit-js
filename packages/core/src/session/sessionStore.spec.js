import {
  selectSessionStoreStrategyType,
  startSessionStore
} from './sessionStore'
import { SessionPersistence, SESSION_STORE_KEY } from './sessionConstants'
import { display } from '../helper/display'

describe('sessionStore', () => {
  const now = new Date('2024-01-01T00:00:00.000Z')

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(now)
    localStorage.clear()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    localStorage.clear()
  })

  it('should select storage strategies and report invalid persistence values', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(
      selectSessionStoreStrategyType({
        sessionPersistence: SessionPersistence.LOCAL_STORAGE
      })
    ).toEqual({ type: SessionPersistence.LOCAL_STORAGE })

    expect(
      selectSessionStoreStrategyType({
        allowFallbackToLocalStorage: true
      })
    ).toBeDefined()

    expect(
      selectSessionStoreStrategyType({
        sessionPersistence: 'invalid'
      })
    ).toBeUndefined()
    expect(displayErrorSpy).toHaveBeenCalledWith(
      "Invalid session persistence 'invalid'"
    )
  })

  it('should initialize with an expired session and renew it on first tracked expansion', () => {
    const store = startSessionStore(
      { type: SessionPersistence.LOCAL_STORAGE },
      'rum',
      function () {
        return { trackingType: 'tracked', isTracked: true }
      }
    )
    const renewSpy = jasmine.createSpy('renew')
    store.renewObservable.subscribe(renewSpy)

    expect(store.getSession()).toEqual({ isExpired: '1' })

    store.expandOrRenewSession()

    const session = store.getSession()
    expect(session.rum).toBe('tracked')
    expect(session.id).toEqual(jasmine.any(String))
    expect(session.created).toBe(String(now.getTime()))
    expect(renewSpy).toHaveBeenCalledTimes(1)
    expect(localStorage.getItem(SESSION_STORE_KEY)).toContain('rum=tracked')

    store.stop()
  })

  it('should notify session updates when the same session is modified', () => {
    const store = startSessionStore(
      { type: SessionPersistence.LOCAL_STORAGE },
      'rum',
      function () {
        return { trackingType: 'tracked', isTracked: true }
      }
    )
    const updateSpy = jasmine.createSpy('update')

    store.expandOrRenewSession()
    store.sessionStateUpdateObservable.subscribe(updateSpy)
    store.updateSessionState({ plan: 'pro' })

    expect(updateSpy).toHaveBeenCalledTimes(1)
    expect(updateSpy.calls.mostRecent().args[0]).toEqual({
      previousState: jasmine.objectContaining({
        rum: 'tracked'
      }),
      newState: jasmine.objectContaining({
        rum: 'tracked',
        plan: 'pro'
      })
    })
    expect(store.getSession()).toEqual(
      jasmine.objectContaining({
        rum: 'tracked',
        plan: 'pro'
      })
    )

    store.stop()
  })

  it('should notify expiration when the active session is explicitly expired', () => {
    const store = startSessionStore(
      { type: SessionPersistence.LOCAL_STORAGE },
      'rum',
      function () {
        return { trackingType: 'tracked', isTracked: true }
      }
    )
    const expireSpy = jasmine.createSpy('expire')

    store.expandOrRenewSession()
    store.expireObservable.subscribe(expireSpy)
    store.expire()

    expect(expireSpy).toHaveBeenCalledTimes(1)
    expect(store.getSession()).toEqual({ isExpired: '1' })
    expect(localStorage.getItem(SESSION_STORE_KEY)).toBe('isExpired=1')

    store.stop()
  })
})
