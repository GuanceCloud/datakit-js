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

import { STATUSES, HandlerType } from './logger'
import { isAuthorized } from './logsCollection/logger/loggerCollection'

export function startLogsAssembly(
  sessionManager,
  configuration,
  lifeCycle,
  buildCommonContext,
  mainLogger,
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
    // { rawLogsEvent, messageContext = undefined, savedCommonContext = undefined, logger = mainLogger }
    var rawLogsEvent = data.rawLogsEvent
    var messageContext = data.messageContext || undefined
    var savedCommonContext = data.savedCommonContext || undefined
    var logger = data.logger || mainLogger
    var startTime = getRelativeTime(rawLogsEvent.date)
    var session = sessionManager.findTrackedSession(startTime)

    if (!session) {
      return
    }
    var commonContext = savedCommonContext || buildCommonContext()
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
      commonContext.context,
      getRUMInternalContext(startTime),
      rawLogsEvent,
      logger.getContext(),
      messageContext
    )

    if (
      !isAuthorized(rawLogsEvent.status, HandlerType.http, logger) ||
      (configuration.beforeSend && configuration.beforeSend(log) === false) ||
      (log.error &&
        log.error.origin !== ErrorSource.AGENT &&
        isNullUndefinedDefaultValue(
          logRateLimiters[log.status],
          logRateLimiters['custom']
        ).isLimitReached())
    ) {
      return
    }

    lifeCycle.notify(LifeCycleEventType.LOG_COLLECTED, withSnakeCaseKeys(log))
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
