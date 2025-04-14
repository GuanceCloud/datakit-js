import {
  clocksNow,
  ErrorHandling,
  ErrorSource,
  initReportObservable,
  RawReportType
} from '@cloudcare/browser-core'

export function trackReportError(configuration, errorObservable) {
  var subscription = initReportObservable(configuration, [
    (RawReportType.cspViolation, RawReportType.intervention)
  ]).subscribe(function (reportError) {
    errorObservable.notify({
      startClocks: clocksNow(),
      message: reportError.message,
      stack: reportError.stack,
      type: reportError.subtype,
      source: ErrorSource.REPORT,
      handling: ErrorHandling.UNHANDLED
    })
  })

  return {
    stop: function () {
      subscription.unsubscribe()
    }
  }
}
