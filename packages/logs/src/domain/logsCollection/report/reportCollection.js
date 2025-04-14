import {
  timeStampNow,
  ErrorSource,
  getFileFromStackTraceString,
  initReportObservable,
  LifeCycleEventType
} from '@cloudcare/browser-core'
import { StatusType } from '../../logger'
import { createErrorFieldFromRawError } from '../../createErrorFieldFromRawError'

export function startReportCollection(configuration, lifeCycle) {
  var reportSubscription = initReportObservable(
    configuration,
    configuration.forwardReports
  ).subscribe(function (rawError) {
    var message = rawError.message
    var status =
      rawError.originalError.type === 'deprecation'
        ? StatusType.warn
        : StatusType.error
    var error
    if (status === StatusType.error) {
      error = createErrorFieldFromRawError(rawError)
    } else if (report.stack) {
      message += ' Found in ' + getFileFromStackTraceString(rawError.stack)
    }

    lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, {
      rawLogsEvent: {
        date: timeStampNow(),
        message: message,
        origin: ErrorSource.REPORT,
        error: error,
        status: status
      }
    })
  })

  return {
    stop: function () {
      reportSubscription.unsubscribe()
    }
  }
}
