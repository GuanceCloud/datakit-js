import {
  performDraw,
  startSessionManager,
  Observable
} from '@cloudcare/browser-core'

export var LOGS_SESSION_KEY = 'logs'

export var LoggerTrackingType = {
  NOT_TRACKED: '0',
  TRACKED: '1'
}

export function startLogsSessionManager(configuration) {
  var sessionManager = startSessionManager(
    configuration,
    LOGS_SESSION_KEY,
    function (rawTrackingType) {
      return computeSessionState(configuration, rawTrackingType)
    }
  )
  return {
    findTrackedSession: function (startTime) {
      var session = sessionManager.findSession(startTime)
      return session && session.trackingType === LoggerTrackingType.TRACKED
        ? {
            id: session.id
          }
        : undefined
    },
    expireObservable: sessionManager.expireObservable
  }
}

export function startLogsSessionManagerStub(configuration) {
  var isTracked =
    computeTrackingType(configuration) === LoggerTrackingType.TRACKED
  var session = isTracked ? {} : undefined
  return {
    findTrackedSession: function () {
      return session
    },
    expireObservable: new Observable()
  }
}

function computeTrackingType(configuration) {
  if (!performDraw(configuration.sessionSampleRate)) {
    return LoggerTrackingType.NOT_TRACKED
  }
  return LoggerTrackingType.TRACKED
}

function computeSessionState(configuration, rawSessionType) {
  var trackingType = hasValidLoggerSession(rawSessionType)
    ? rawSessionType
    : computeTrackingType(configuration)
  return {
    trackingType: trackingType,
    isTracked: trackingType === LoggerTrackingType.TRACKED
  }
}

function hasValidLoggerSession(trackingType) {
  return (
    trackingType === LoggerTrackingType.NOT_TRACKED ||
    trackingType === LoggerTrackingType.TRACKED
  )
}
