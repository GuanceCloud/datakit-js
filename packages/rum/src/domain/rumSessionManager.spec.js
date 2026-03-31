import {
  BridgeCapability,
  Observable,
  SESSION_NOT_TRACKED
} from '@cloudcare/browser-core'
import {
  ERROR_SESSION,
  RumSessionPlan,
  RumTrackingType,
  startRumSessionManagerStub
} from './rumSessionManager'

describe('rumSessionManager', () => {
  let originalBridge

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
  })

  it('should expose the stub session and enable replay when records are supported', () => {
    window.FTWebViewJavascriptBridge = {
      getCapabilities: () => JSON.stringify([BridgeCapability.RECORDS])
    }

    const sessionManager = startRumSessionManagerStub()
    const session = sessionManager.findTrackedSession()

    expect(session.id).toBe('00000000-aaaa-0000-aaaa-000000000000')
    expect(session.sessionReplayAllowed).toBeTrue()
    expect(session.errorSessionReplayAllowed).toBeFalse()
    expect(session.isErrorSession).toBeFalse()
  })

  it('should mark the stub session as errored when requested', () => {
    window.FTWebViewJavascriptBridge = {}

    const sessionManager = startRumSessionManagerStub()
    sessionManager.setErrorForSession()

    expect(sessionManager.findTrackedSession()).toEqual(
      jasmine.objectContaining({
        sessionHasError: true,
        isErrorSession: true,
        errorSessionReplayAllowed: true,
        sessionErrorTimestamp: jasmine.any(Number)
      })
    )
  })

  it('should expose stable tracking constants', () => {
    expect(ERROR_SESSION).toBe('1')
    expect(RumSessionPlan.WITHOUT_SESSION_REPLAY).toBe(1)
    expect(RumSessionPlan.WITH_SESSION_REPLAY).toBe(2)
    expect(RumSessionPlan.WITH_ERROR_SESSION_REPLAY).toBe(3)
    expect(RumTrackingType.NOT_TRACKED).toBe(SESSION_NOT_TRACKED)
  })
})
