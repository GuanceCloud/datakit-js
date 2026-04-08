import { startInternalContext } from './internalContext'

describe('logs/internalContext', () => {
  it('should expose the tracked session id for a given start time', () => {
    const internalContext = startInternalContext({
      findTrackedSession: jasmine
        .createSpy('findTrackedSession')
        .and.returnValue({ id: 'session-1' })
    })

    expect(internalContext.get(123)).toEqual({
      session: {
        id: 'session-1'
      }
    })
  })

  it('should return undefined when there is no tracked session', () => {
    const internalContext = startInternalContext({
      findTrackedSession: jasmine
        .createSpy('findTrackedSession')
        .and.returnValue(undefined)
    })

    expect(internalContext.get(123)).toBeUndefined()
  })
})
