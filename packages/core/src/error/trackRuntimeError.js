import { ErrorSource, computeRawError } from '../helper/errorTools'
import { clocksNow } from '../helper/tools'
import { ErrorHandling, NonErrorPrefix } from '../helper/enums'
import { startUnhandledErrorCollection } from '../tracekit'

export function trackRuntimeError(errorObservable) {
  return startUnhandledErrorCollection(function (stackTrace, originalError) {
    errorObservable.notify(
      computeRawError({
        stackTrace: stackTrace,
        originalError: originalError,
        startClocks: clocksNow(),
        nonErrorPrefix: NonErrorPrefix.UNCAUGHT,
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED
      })
    )
  })
}
