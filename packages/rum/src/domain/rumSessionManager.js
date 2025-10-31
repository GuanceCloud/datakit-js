import {
  performDraw,
  startSessionManager,
  LifeCycleEventType,
  noop,
  Observable,
  timeStampNow,
  bridgeSupports,
  BridgeCapability,
  SESSION_NOT_TRACKED
} from '@cloudcare/browser-core'

export var RUM_SESSION_KEY = 'rum'

export var RumSessionPlan = {
  WITHOUT_SESSION_REPLAY: 1,
  WITH_SESSION_REPLAY: 2,
  WITH_ERROR_SESSION_REPLAY: 3
}
export const ERROR_SESSION = '1'
export var RumTrackingType = {
  NOT_TRACKED: SESSION_NOT_TRACKED,
  // Note: the "tracking type" value (stored in the session cookie) does not match the "session
  // plan" value (sent in RUM events). This is expected, and was done to keep retrocompatibility
  // with active sessions when upgrading the SDK.

  TRACKED_WITH_SESSION_AND_WITH_SESSION_REPLAY: '1',
  TRACKED_WITH_SESSION_AND_WITHOUT_SESSION_REPLAY: '2',
  TRACKED_WITH_SESSION_AND_WITH_ERROR_SESSION_REPLAY: '3',
  TRACKED_WITH_ERROR_SESSION_AND_WITH_SESSION_REPLAY: '4',
  TRACKED_WITH_ERROR_SESSION_AND_WITHOUT_SESSION_REPLAY: '5',
  TRACKED_WITH_ERROR_SESSION_AND_WITH_ERROR_SESSION_REPLAY: '6'
}

export function startRumSessionManager(configuration, lifeCycle) {
  var sessionManager = startSessionManager(
    configuration,
    RUM_SESSION_KEY,
    function (rawTrackingType) {
      return computeSessionState(configuration, rawTrackingType)
    }
  )

  sessionManager.expireObservable.subscribe(function () {
    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)
  })

  sessionManager.renewObservable.subscribe(function () {
    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)
  })
  sessionManager.sessionStateUpdateObservable.subscribe(
    ({ previousState, newState }) => {
      if (!previousState.hasError && newState.hasError) {
        const sessionEntity = sessionManager.findSession()
        if (sessionEntity) {
          sessionEntity.hasError = true
          sessionEntity.ets = newState.ets || timeStampNow()
        }
      }
      if (!previousState.forcedSession && newState.forcedSession) {
        const sessionEntity = sessionManager.findSession()
        if (sessionEntity) {
          sessionEntity.isSessionForced = true
        }
      }
    }
  )
  return {
    findTrackedSession: function (startTime) {
      var session = sessionManager.findSession(startTime)
      if (!session) {
        return
      }
      if (!isTypeTracked(session.trackingType) && !session.isSessionForced) {
        return
      }
      const isErrorSession =
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITHOUT_SESSION_REPLAY ||
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_SESSION_REPLAY ||
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_ERROR_SESSION_REPLAY

      let plan = RumSessionPlan.WITHOUT_SESSION_REPLAY
      if (
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_SESSION_AND_WITH_SESSION_REPLAY ||
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_SESSION_REPLAY
      ) {
        plan = RumSessionPlan.WITH_SESSION_REPLAY
      } else if (
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_ERROR_SESSION_REPLAY ||
        session.trackingType ===
          RumTrackingType.TRACKED_WITH_SESSION_AND_WITH_ERROR_SESSION_REPLAY
      ) {
        plan = RumSessionPlan.WITH_ERROR_SESSION_REPLAY
      }

      return {
        id: session.id,
        plan: plan,
        errorSessionReplayAllowed:
          plan === RumSessionPlan.WITH_ERROR_SESSION_REPLAY,
        sessionHasError: session.hasError,
        isErrorSession: isErrorSession,
        sessionErrorTimestamp: session.ets,
        isSessionForced: session.isSessionForced,
        sessionReplayAllowed:
          plan === RumSessionPlan.WITH_SESSION_REPLAY ||
          plan === RumSessionPlan.WITH_ERROR_SESSION_REPLAY ||
          session.isSessionForced
      }
    },
    expire: sessionManager.expire,
    expireObservable: sessionManager.expireObservable,
    sessionStateUpdateObservable: sessionManager.sessionStateUpdateObservable,
    setErrorForSession: () =>
      sessionManager.updateSessionState({ hasError: '1', ets: timeStampNow() }),
    setForcedSession: () => {
      sessionManager.updateSessionState({ forcedSession: '1' })
    }
  }
}

/**
 * Start a tracked replay session stub
 * It needs to be a premium plan in order to get long tasks
 */
export function startRumSessionManagerStub() {
  var session = {
    id: '00000000-aaaa-0000-aaaa-000000000000',
    isErrorSession: false,
    sessionErrorTimestamp: 0,
    sessionReplayAllowed: bridgeSupports(BridgeCapability.RECORDS)
      ? true
      : false,
    errorSessionReplayAllowed: false,
    sessionHasError: false,
    isSessionForced: false
  }
  return {
    findTrackedSession: function () {
      return session
    },
    expire: noop,
    expireObservable: new Observable(),
    setErrorForSession: function () {
      session.sessionErrorTimestamp = timeStampNow()
      session.sessionHasError = true
      session.isErrorSession = true
      session.errorSessionReplayAllowed = true
    },
    setForcedSession: noop
  }
}

function computeSessionState(configuration, rawTrackingType) {
  const {
    sessionSampleRate,
    sessionOnErrorSampleRate,
    sessionReplaySampleRate,
    sessionReplayOnErrorSampleRate
  } = configuration
  const isSession = performDraw(sessionSampleRate)
  const isErrorSession = performDraw(sessionOnErrorSampleRate)
  const isSessionReplay = performDraw(sessionReplaySampleRate)
  const isErrorSessionReplay = performDraw(sessionReplayOnErrorSampleRate)
  var trackingType
  if (hasValidRumSession(rawTrackingType)) {
    trackingType = rawTrackingType
  } else if (!isErrorSession && !isSession) {
    trackingType = RumTrackingType.NOT_TRACKED
  } else if (isSession && isSessionReplay) {
    trackingType = RumTrackingType.TRACKED_WITH_SESSION_AND_WITH_SESSION_REPLAY
  } else if (isSession && isErrorSessionReplay) {
    trackingType =
      RumTrackingType.TRACKED_WITH_SESSION_AND_WITH_ERROR_SESSION_REPLAY
  } else if (isSession && !isSessionReplay && !isErrorSessionReplay) {
    trackingType =
      RumTrackingType.TRACKED_WITH_SESSION_AND_WITHOUT_SESSION_REPLAY
  } else if (isErrorSession && isSessionReplay) {
    trackingType =
      RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_SESSION_REPLAY
  } else if (isErrorSession && isErrorSessionReplay) {
    trackingType =
      RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_ERROR_SESSION_REPLAY
  } else if (isErrorSession && !isSessionReplay && !isErrorSessionReplay) {
    trackingType =
      RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITHOUT_SESSION_REPLAY
  }
  //   if (hasValidRumSession(rawTrackingType)) {
  //     trackingType = rawTrackingType
  //   } else if (
  //     !performDraw(configuration.sessionSampleRate) &&
  //     !performDraw(configuration.sessionOnErrorSampleRate)
  //   ) {
  //     trackingType = RumTrackingType.NOT_TRACKED
  //   } else if (
  //     !performDraw(configuration.sessionReplaySampleRate) &&
  //     !performDraw(configuration.sessionReplayOnErrorSampleRate)
  //   ) {
  //     trackingType = RumTrackingType.TRACKED_WITHOUT_SESSION_REPLAY
  //   } else if (performDraw(configuration.sessionReplayOnErrorSampleRate)) {
  //     trackingType = RumTrackingType.TRACKED_WITH_ERROR_SESSION_REPLAY
  //   } else {
  //     trackingType = RumTrackingType.TRACKED_WITH_SESSION_REPLAY
  //   }
  return {
    trackingType: trackingType,
    isTracked: isTypeTracked(trackingType)
  }
}

function hasValidRumSession(trackingType) {
  return (
    trackingType === RumTrackingType.NOT_TRACKED ||
    trackingType ===
      RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITHOUT_SESSION_REPLAY ||
    trackingType ===
      RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_ERROR_SESSION_REPLAY ||
    trackingType ===
      RumTrackingType.TRACKED_WITH_ERROR_SESSION_AND_WITH_SESSION_REPLAY ||
    trackingType ===
      RumTrackingType.TRACKED_WITH_SESSION_AND_WITHOUT_SESSION_REPLAY ||
    trackingType ===
      RumTrackingType.TRACKED_WITH_SESSION_AND_WITH_ERROR_SESSION_REPLAY ||
    trackingType ===
      RumTrackingType.TRACKED_WITH_SESSION_AND_WITH_SESSION_REPLAY
  )
}

function isTypeTracked(rumSessionType) {
  return rumSessionType !== RumTrackingType.NOT_TRACKED
}
