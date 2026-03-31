import {
  SESSION_EXPIRATION_DELAY,
  SESSION_NOT_TRACKED,
  SESSION_STORE_KEY,
  SESSION_TIME_OUT_DELAY,
  SessionPersistence
} from './sessionConstants'

describe('sessionConstants', () => {
  it('should expose session timing and storage constants', () => {
    expect(SESSION_TIME_OUT_DELAY).toBe(4 * 60 * 60 * 1000)
    expect(SESSION_EXPIRATION_DELAY).toBe(15 * 60 * 1000)
    expect(SESSION_STORE_KEY).toBe('_gc_s')
    expect(SESSION_NOT_TRACKED).toBe('0')
  })

  it('should expose session persistence strategies', () => {
    expect(SessionPersistence).toEqual({
      COOKIE: 'cookie',
      LOCAL_STORAGE: 'local-storage'
    })
  })
})
