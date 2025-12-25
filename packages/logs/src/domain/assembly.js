import {
  ErrorSource,
  extend2Lev,
  createEventRateLimiter,
  getRelativeTime,
  withSnakeCaseKeys,
  LifeCycleEventType,
  deviceInfo,
  each,
  RumEventType,
  isEmptyObject,
  isNullUndefinedDefaultValue
} from '@cloudcare/browser-core'

import { STATUSES } from './logger'

export function startLogsAssembly(
  sessionManager,
  configuration,
  lifeCycle,
  getCommonContext,
  reportError
) {
  var statusWithCustom = STATUSES.concat(['custom'])
  var logRateLimiters = {}
  each(statusWithCustom, function (status) {
    logRateLimiters[status] = createEventRateLimiter(
      status,
      configuration.eventRateLimiterThreshold,
      reportError
    )
  })
  lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, function (data) {
    var rawLogsEvent = data.rawLogsEvent
    var messageContext = data.messageContext || undefined
    var savedCommonContext = data.savedCommonContext || undefined
    var domainContext = data.domainContext
    var startTime = getRelativeTime(rawLogsEvent.date)
    var session = sessionManager.findTrackedSession(startTime)

    if (!session) {
      return
    }
    var commonContext = savedCommonContext || getCommonContext()
    var log = extend2Lev(
      {
        service: configuration.service || 'browser',
        env: configuration.env || '',
        version: configuration.version || '',
        _gc: {
          sdkName: configuration.sdkName,
          sdkVersion: configuration.sdkVersion
        },
        session: {
          id: session.id
        },
        view: commonContext.view,
        user: !isEmptyObject(commonContext.user)
          ? commonContext.user
          : undefined,
        device: deviceInfo,
        type: RumEventType.LOGGER
      },
      getRUMInternalContext(startTime)
    )

    let serverLogEvent = withSnakeCaseKeys(log)
    serverLogEvent = extend2Lev(
      serverLogEvent,
      commonContext.context,
      messageContext,
      rawLogsEvent
    )
    if (
      (configuration.beforeSend &&
        configuration.beforeSend(serverLogEvent, domainContext) === false) ||
      (serverLogEvent.origin !== ErrorSource.AGENT &&
        isNullUndefinedDefaultValue(
          logRateLimiters[serverLogEvent.status],
          logRateLimiters['custom']
        ).isLimitReached())
    ) {
      return
    }

    lifeCycle.notify(LifeCycleEventType.LOG_COLLECTED, serverLogEvent)
  })
}

export function getRUMInternalContext(startTime) {
  return getInternalContextFromRumGlobal(window.DATAFLUX_RUM)

  function getInternalContextFromRumGlobal(rumGlobal) {
    if (rumGlobal && rumGlobal.getInternalContext) {
      return rumGlobal.getInternalContext(startTime)
    }
  }
}
