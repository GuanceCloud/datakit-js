import {
  EXPIRED,
  expandSessionState,
  getExpiredSessionState,
  isSessionInExpiredState,
  isSessionInNotStartedState,
  isSessionStarted,
  toSessionState,
  toSessionString
} from './sessionState'
import {
  SESSION_EXPIRATION_DELAY,
  SESSION_TIME_OUT_DELAY
} from './sessionConstants'

describe('sessionState', () => {
  const now = new Date('2024-01-01T00:00:00.000Z')

  beforeEach(() => {
    jasmine.clock().install()
    jasmine.clock().mockDate(now)
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should create an expired session state', () => {
    expect(getExpiredSessionState()).toEqual({ isExpired: EXPIRED })
  })

  it('should detect not started and started sessions', () => {
    expect(isSessionInNotStartedState({})).toBeTrue()
    expect(isSessionStarted({})).toBeFalse()

    expect(isSessionInNotStartedState({ id: 'abc' })).toBeFalse()
    expect(isSessionStarted({ id: 'abc' })).toBeTrue()
  })

  it('should expand the session expiration from the current time', () => {
    const session = { id: 'abc' }

    expandSessionState(session)

    expect(session.expire).toBe(
      String(now.getTime() + SESSION_EXPIRATION_DELAY)
    )
  })

  it('should mark sessions as expired when explicitly flagged', () => {
    expect(isSessionInExpiredState({ isExpired: EXPIRED })).toBeTrue()
  })

  it('should mark sessions as expired when created too long ago', () => {
    expect(
      isSessionInExpiredState({
        created: String(now.getTime() - SESSION_TIME_OUT_DELAY - 1)
      })
    ).toBeTrue()
    expect(
      isSessionInExpiredState({
        created: String(now.getTime() - SESSION_TIME_OUT_DELAY + 1)
      })
    ).toBeFalse()
  })

  it('should mark sessions as expired when the expiration timestamp is in the past', () => {
    expect(
      isSessionInExpiredState({
        expire: String(now.getTime() - 1)
      })
    ).toBeTrue()
    expect(
      isSessionInExpiredState({
        expire: String(now.getTime() + 1)
      })
    ).toBeFalse()
  })

  it('should serialize and deserialize session state', () => {
    const session = {
      id: 'abc-123',
      created: '1704067200000'
    }

    expect(toSessionString(session)).toBe(
      'id=abc-123&created=1704067200000'
    )
    expect(toSessionState('id=abc-123&created=1704067200000')).toEqual(session)
  })

  it('should ignore invalid session strings', () => {
    expect(toSessionState('')).toEqual({})
    expect(toSessionState('invalid=value!')).toEqual({})
    expect(toSessionState('id=abc-123&invalid=value!')).toEqual({ id: 'abc-123' })
  })
})
