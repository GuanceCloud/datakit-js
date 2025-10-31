import {
  assign,
  computeStackTrace,
  computeRawError,
  ErrorSource,
  UUID,
  ErrorHandling,
  Observable,
  trackRuntimeError,
  RumEventType,
  LifeCycleEventType,
  NonErrorPrefix
} from '@cloudcare/browser-core'
import { trackConsoleError } from './trackConsoleError'
import { trackReportError } from './trackReportError'
import { PageState } from '../../contexts/pageStateHistory'

export function startErrorCollection(
  lifeCycle,
  configuration,
  sessionManager,
  pageStateHistory
) {
  var errorObservable = new Observable()

  trackConsoleError(errorObservable)
  trackRuntimeError(errorObservable)
  trackReportError(configuration, errorObservable)
  var session = sessionManager.findTrackedSession()
  let hasError = session && session.isErrorSession && session.sessionHasError
  if (session && session.isErrorSession) {
    lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, function () {
      hasError = false
    })
  }

  errorObservable.subscribe(function (error) {
    if (session && session.isErrorSession && !hasError) {
      sessionManager.setErrorForSession()
      hasError = true
    }
    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, { error: error })
  })

  return doStartErrorCollection(lifeCycle, pageStateHistory)
}

export function doStartErrorCollection(lifeCycle, pageStateHistory) {
  lifeCycle.subscribe(LifeCycleEventType.RAW_ERROR_COLLECTED, function (error) {
    lifeCycle.notify(
      LifeCycleEventType.RAW_RUM_EVENT_COLLECTED,
      assign(
        {
          customerContext: error.customerContext,
          savedCommonContext: error.savedCommonContext
        },
        processError(error.error, pageStateHistory)
      )
    )
  })

  return {
    addError: function (providedError, savedCommonContext) {
      var error = providedError.error
      var stackTrace =
        error instanceof Error ? computeStackTrace(error) : undefined
      var rawError = computeRawError({
        stackTrace,
        originalError: error,
        handlingStack: providedError.handlingStack,
        startClocks: providedError.startClocks,
        nonErrorPrefix: NonErrorPrefix.PROVIDED,
        source: ErrorSource.CUSTOM,
        handling: ErrorHandling.HANDLED
      })
      lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
        customerContext: providedError.context,
        savedCommonContext: savedCommonContext,
        error: rawError
      })
    }
  }
}

function processError(error, pageStateHistory) {
  var rawRumEvent = {
    date: error.startClocks.timeStamp,
    error: {
      id: UUID(),
      message: error.message,
      source: error.source,
      stack: error.stack,
      handling_stack: error.handlingStack,
      type: error.type,
      handling: error.handling,
      causes: error.causes,
      source_type: 'browser'
    },
    type: RumEventType.ERROR,
    view: {
      in_foreground: pageStateHistory.wasInPageStateAt(
        PageState.ACTIVE,
        error.startClocks.relative
      )
    }
  }

  return {
    rawRumEvent: rawRumEvent,
    startTime: error.startClocks.relative,
    domainContext: {
      error: error.originalError
    }
  }
}
