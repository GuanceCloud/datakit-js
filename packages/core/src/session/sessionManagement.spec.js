import {
  startSessionManager,
  stopSessionManager
} from './sessionManagement'
import { SessionPersistence } from './sessionConstants'

describe('sessionManagement', () => {
  const now = new Date('2024-01-01T00:00:00.000Z')
  let originalVisibilityState

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(now)
    localStorage.clear()
    originalVisibilityState = document.visibilityState
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
  })

  afterEach(() => {
    stopSessionManager()
    localStorage.clear()
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: originalVisibilityState
    })
    jasmine.clock().uninstall()
  })

  function createManager() {
    return startSessionManager(
      {
        sessionStoreStrategyType: { type: SessionPersistence.LOCAL_STORAGE }
      },
      'rum',
      function () {
        return { trackingType: 'tracked', isTracked: true }
      }
    )
  }

  it('should create an initial active session context', () => {
    const manager = createManager()

    expect(manager.findSession()).toEqual(
      jasmine.objectContaining({
        trackingType: 'tracked',
        isSessionForced: false,
        hasError: false,
        id: jasmine.any(String)
      })
    )
  })

  it('should close the active context when the session expires', () => {
    const manager = createManager()
    const expireSpy = jasmine.createSpy('expire')
    manager.expireObservable.subscribe(expireSpy)

    manager.expire()

    expect(expireSpy).toHaveBeenCalledTimes(1)
    expect(manager.findSession()).toBeUndefined()
    expect(manager.findSession(undefined, { returnInactive: true })).toEqual(
      jasmine.objectContaining({
        trackingType: 'tracked'
      })
    )
  })

  it('should renew the session on tracked user activity after expiration', () => {
    const manager = createManager()
    const renewSpy = jasmine.createSpy('renew')
    manager.renewObservable.subscribe(renewSpy)

    manager.expire()
    window.dispatchEvent(new Event('click'))

    expect(renewSpy).toHaveBeenCalledTimes(1)
    expect(manager.findSession()).toEqual(
      jasmine.objectContaining({
        trackingType: 'tracked',
        id: jasmine.any(String)
      })
    )
  })
})
