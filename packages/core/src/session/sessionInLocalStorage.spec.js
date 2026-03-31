import {
  initLocalStorageStrategy,
  selectLocalStorageStrategy
} from './sessionInLocalStorage'
import { SessionPersistence, SESSION_STORE_KEY } from './sessionConstants'
import { EXPIRED } from './sessionState'

describe('sessionInLocalStorage', () => {
  let originalSetItem
  let originalGetItem
  let originalRemoveItem

  beforeEach(() => {
    originalSetItem = localStorage.setItem
    originalGetItem = localStorage.getItem
    originalRemoveItem = localStorage.removeItem
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.setItem = originalSetItem
    localStorage.getItem = originalGetItem
    localStorage.removeItem = originalRemoveItem
    localStorage.clear()
  })

  it('should select local storage when write/read/remove succeeds', () => {
    expect(selectLocalStorageStrategy()).toEqual({
      type: SessionPersistence.LOCAL_STORAGE
    })
  })

  it('should return undefined when local storage access throws', () => {
    localStorage.setItem = jasmine
      .createSpy('setItem')
      .and.throwError('quota exceeded')

    expect(selectLocalStorageStrategy()).toBeUndefined()
  })

  it('should persist, retrieve and expire sessions through the strategy', () => {
    const strategy = initLocalStorageStrategy()
    const session = {
      id: 'abc-123',
      created: '1700000000000'
    }

    expect(strategy.isLockEnabled).toBeFalse()

    strategy.persistSession(session)
    expect(localStorage.getItem(SESSION_STORE_KEY)).toBe(
      'id=abc-123&created=1700000000000'
    )
    expect(strategy.retrieveSession()).toEqual(session)

    strategy.expireSession()
    expect(strategy.retrieveSession()).toEqual({ isExpired: EXPIRED })
  })
})
