import { Observable } from '@cloudcare/browser-core'
import { startLogsSessionManagerStub } from './logsSessionManager'

describe('logs/logsSessionManager', () => {
  it('should return a tracked stub session when sampling keeps the session', () => {
    const sessionManager = startLogsSessionManagerStub({
      sessionSampleRate: 100
    })

    expect(sessionManager.findTrackedSession()).toEqual({})
    expect(sessionManager.expireObservable).toEqual(jasmine.any(Observable))
  })

  it('should return no session when sampling drops the session', () => {
    const sessionManager = startLogsSessionManagerStub({
      sessionSampleRate: 0
    })

    expect(sessionManager.findTrackedSession()).toBeUndefined()
  })
})
