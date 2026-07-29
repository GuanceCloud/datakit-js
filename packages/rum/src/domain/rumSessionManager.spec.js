import {
  BridgeCapability,
  LifeCycle,
  LifeCycleEventType,
  Observable,
  SessionPersistence,
  display,
  stopSessionManager,
  SESSION_NOT_TRACKED
} from '@cloudcare/browser-core'
import {
  ERROR_SESSION,
  RumSessionPlan,
  RumTrackingType,
  startRumSessionManager,
  startRumSessionManagerStub
} from './rumSessionManager'

describe('rumSessionManager', () => {
  let originalBridge

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
    stopSessionManager()
    localStorage.clear()
  })

  function createSessionManager(configuration, lifeCycle = new LifeCycle()) {
    return startRumSessionManager(
      Object.assign(
        {
          sessionStoreStrategyType: {
            type: SessionPersistence.LOCAL_STORAGE
          },
          sessionSampleRate: 0,
          sessionOnErrorSampleRate: 0,
          sessionReplaySampleRate: 0,
          sessionReplayOnErrorSampleRate: 0
        },
        configuration
      ),
      lifeCycle
    )
  }

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

  it('should assign an id when forcing an untracked session', () => {
    const lifeCycle = new LifeCycle()
    const expiredSpy = jasmine.createSpy('expired')
    const renewedSpy = jasmine.createSpy('renewed')
    lifeCycle.subscribe(LifeCycleEventType.SESSION_EXPIRED, expiredSpy)
    lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, renewedSpy)
    const sessionManager = createSessionManager({}, lifeCycle)

    expect(sessionManager.findTrackedSession()).toBeUndefined()

    sessionManager.setForcedSession()

    expect(sessionManager.findTrackedSession()).toEqual(
      jasmine.objectContaining({
        id: jasmine.any(String),
        isSessionForced: true,
        sessionReplayAllowed: true
      })
    )
    expect(expiredSpy).not.toHaveBeenCalled()
    expect(renewedSpy).not.toHaveBeenCalled()
  })

  it('should keep the current id when forcing an already tracked session', () => {
    const sessionManager = createSessionManager({
      sessionSampleRate: 100
    })
    const sessionId = sessionManager.findTrackedSession().id

    sessionManager.setForcedSession()

    expect(sessionManager.findTrackedSession()).toEqual(
      jasmine.objectContaining({
        id: sessionId,
        isSessionForced: true,
        sessionReplayAllowed: true
      })
    )
  })

  it('should immediately start a new session with a runtime sample rate override', () => {
    const sessionManager = createSessionManager({
      sessionSampleRate: 0
    })

    expect(sessionManager.findTrackedSession()).toBeUndefined()

    sessionManager.startSession({ sessionSampleRate: 100 })

    const firstSession = sessionManager.findTrackedSession()
    expect(firstSession).toEqual(
      jasmine.objectContaining({
        id: jasmine.any(String)
      })
    )

    sessionManager.startSession()

    expect(sessionManager.findTrackedSession().id).not.toBe(firstSession.id)
  })

  it('should reject an invalid runtime sample rate without renewing', () => {
    const displayErrorSpy = spyOn(display, 'error')
    const sessionManager = createSessionManager({
      sessionSampleRate: 100
    })
    const sessionId = sessionManager.findTrackedSession().id

    sessionManager.startSession({ sessionSampleRate: 101 })

    expect(displayErrorSpy).toHaveBeenCalledWith(
      'startSession options should contain a sessionSampleRate between 0 and 100'
    )
    expect(sessionManager.findTrackedSession().id).toBe(sessionId)
  })
})
