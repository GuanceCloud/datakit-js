import {
  includes,
  extend2Lev,
  ErrorSource,
  timeStampNow,
  LifeCycleEventType,
  isArray,
  originalConsoleMethods
} from '@cloudcare/browser-core'
import { HandlerType } from '../../logger'

export var STATUS_PRIORITIES = {
  ok: 0,
  debug: 1,
  info: 2,
  notice: 4,
  warn: 5,
  error: 6,
  critical: 7,
  alert: 8,
  emerg: 9
}

export function startLoggerCollection(lifeCycle) {
  function handleLog(
    logsMessage,
    logger,
    handlingStack,
    savedCommonContext,
    savedDate
  ) {
    var messageContext = extend2Lev(logger.getContext(), logsMessage.context)
    if (isAuthorized(logsMessage.status, HandlerType.console, logger)) {
      displayInConsole(logsMessage, messageContext)
    }
    if (isAuthorized(logsMessage.status, HandlerType.http, logger)) {
      var rawLogEventData = {
        rawLogsEvent: {
          date: savedDate || timeStampNow(),
          message: logsMessage.message,
          status: logsMessage.status,
          origin: ErrorSource.LOGGER
        },
        messageContext: messageContext,
        savedCommonContext: savedCommonContext
      }
      if (handlingStack) {
        rawLogEventData.domainContext = { handlingStack }
      }
      lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogEventData)
    }
  }

  return {
    handleLog: handleLog
  }
}

export function isAuthorized(status, handlerType, logger) {
  var loggerHandler = logger.getHandler()
  var sanitizedHandlerType = isArray(loggerHandler)
    ? loggerHandler
    : [loggerHandler]
  return (
    STATUS_PRIORITIES[status] >= STATUS_PRIORITIES[logger.getLevel()] &&
    includes(sanitizedHandlerType, handlerType)
  )
}
function displayInConsole(data, messageContext) {
  var status = data.status
  var message = data.message
  originalConsoleMethods[loggerToConsoleApiName[status]].call(
    globalConsole,
    message,
    messageContext
  )
}
