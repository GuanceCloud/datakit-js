import {
  extend2Lev,
  createContextManager,
  ErrorSource,
  keys,
  CustomerDataType,
  sanitize,
  computeStackTrace,
  computeRawError,
  clocksNow,
  ErrorHandling,
  monitor,
  NonErrorPrefix,
  createHandlingStack
} from '@cloudcare/browser-core'
import { isAuthorized } from './logsCollection/logger/loggerCollection'
import { createErrorFieldFromRawError } from './createErrorFieldFromRawError'
export var StatusType = {
  ok: 'ok',
  debug: 'debug',
  info: 'info',
  notice: 'notice',
  warn: 'warn',
  error: 'error',
  critical: 'critical',
  alert: 'alert',
  emerg: 'emerg'
}

export var HandlerType = {
  console: 'console',
  http: 'http',
  silent: 'silent'
}

export var STATUSES = keys(StatusType)
// eslint-disable-next-line @typescript-eslint/no-redeclare
export function Logger(
  handleLogStrategy,
  customerDataTracker,
  name,
  handlerType,
  level,
  loggerContext
) {
  if (typeof handlerType === 'undefined') {
    handlerType = HandlerType.http
  }
  if (typeof level === 'undefined') {
    level = StatusType.debug
  }
  if (typeof loggerContext === 'undefined') {
    loggerContext = {}
  }
  this.contextManager = createContextManager('logger', { customerDataTracker })
  this.handleLogStrategy = handleLogStrategy
  this.handlerType = handlerType
  this.level = level
  this.contextManager.setContext(loggerContext)
  if (name) {
    this.contextManager.setContextProperty('logger', { name: name })
  }
}
Logger.prototype = {
  logImplementation: monitor(function (
    message,
    messageContext,
    status,
    error,
    handlingStack
  ) {
    if (status === undefined) {
      status = StatusType.info
    }
    var sanitizedMessageContext = sanitize(messageContext)
    var context

    if (error !== undefined && error !== null) {
      var rawError = computeRawError({
        stackTrace:
          error instanceof Error ? computeStackTrace(error) : undefined,
        originalError: error,
        nonErrorPrefix: NonErrorPrefix.PROVIDED,
        source: ErrorSource.LOGGER,
        handling: ErrorHandling.HANDLED,
        startClocks: clocksNow()
      })
      context = extend2Lev(
        {
          error: createErrorFieldFromRawError(rawError, {
            includeMessage: true
          })
        },
        sanitizedMessageContext
      )
    } else {
      context = sanitizedMessageContext
    }

    this.handleLogStrategy(
      {
        message: sanitize(message),
        context: context,
        status: status
      },
      this,
      handlingStack
    )
  }),
  log: function (message, messageContext, status, error) {
    var handlingStack

    if (isAuthorized(status, HandlerType.http, this)) {
      handlingStack = createHandlingStack()
    }

    this.logImplementation(
      message,
      messageContext,
      status,
      error,
      handlingStack
    )
  },

  setContext: function (context) {
    this.contextManager.setContext(context)
  },

  getContext: function () {
    return this.contextManager.getContext()
  },
  setContextProperty: function (key, value) {
    this.contextManager.setContextProperty(key, value)
  },
  addContext: function (key, value) {
    this.contextManager.setContextProperty(key, value)
  },
  removeContextProperty: function (key) {
    this.contextManager.removeContextProperty(key)
  },
  removeContext: function (key) {
    this.contextManager.removeContextProperty(key)
  },
  clearContext: function () {
    this.contextManager.clearContext()
  },
  setHandler: function (handler) {
    this.handlerType = handler
  },

  getHandler: function () {
    return this.handlerType
  },
  setLevel: function (level) {
    this.level = level
  },
  getLevel: function () {
    return this.level
  }
}
Logger.prototype.ok = createLoggerMethod(StatusType.ok)
Logger.prototype.debug = createLoggerMethod(StatusType.debug)
Logger.prototype.info = createLoggerMethod(StatusType.info)
Logger.prototype.notice = createLoggerMethod(StatusType.notice)
Logger.prototype.warn = createLoggerMethod(StatusType.warn)
Logger.prototype.error = createLoggerMethod(StatusType.error)
Logger.prototype.critical = createLoggerMethod(StatusType.critical)
Logger.prototype.alert = createLoggerMethod(StatusType.alert)
Logger.prototype.emerg = createLoggerMethod(StatusType.emerg)
function createLoggerMethod(status) {
  return function (message, messageContext, error) {
    var handlingStack

    if (isAuthorized(status, HandlerType.http, this)) {
      handlingStack = createHandlingStack()
    }
    this.logImplementation(
      message,
      messageContext,
      status,
      error,
      handlingStack
    )
  }
}
