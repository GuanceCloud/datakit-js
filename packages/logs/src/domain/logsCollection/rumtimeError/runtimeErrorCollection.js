import {
  noop,
  ErrorSource,
  trackRuntimeError,
  Observable,
  LifeCycleEventType
} from '@cloudcare/browser-core'
import { StatusType } from '../../logger'
import { createErrorFieldFromRawError } from '../../createErrorFieldFromRawError'
export function startRuntimeErrorCollection(configuration, lifeCycle) {
  if (!configuration.forwardErrorsToLogs) {
    return { stop: noop }
  }

  var rawErrorObservable = new Observable()

  var _trackRuntimeError = trackRuntimeError(rawErrorObservable)

  var rawErrorSubscription = rawErrorObservable.subscribe(function (rawError) {
    lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, {
      rawLogsEvent: {
        message: rawError.message,
        date: rawError.startClocks.timeStamp,
        error: createErrorFieldFromRawError(rawError),
        origin: ErrorSource.SOURCE,
        status: StatusType.error
      }
    })
  })

  return {
    stop: function () {
      _trackRuntimeError.stop()
      rawErrorSubscription.unsubscribe()
    }
  }
}
