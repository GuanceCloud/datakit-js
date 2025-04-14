import { toStackTraceString } from '../helper/errorTools'
import { mergeObservables, Observable } from '../helper/observable'
import {
  includes,
  safeTruncate,
  filter,
  each,
  assign,
  clocksNow
} from '../helper/tools'
import { addEventListener } from '../browser/addEventListener'
import { DOM_EVENT } from '../helper/enums'
import { monitor } from '../helper/monitor'
export var RawReportType = {
  intervention: 'intervention',
  deprecation: 'deprecation',
  cspViolation: 'csp_violation'
}
export function initReportObservable(configuration, apis) {
  var observables = []

  if (includes(apis, RawReportType.cspViolation)) {
    observables.push(createCspViolationReportObservable(configuration))
  }

  var reportTypes = filter(apis, function (api) {
    return api !== RawReportType.cspViolation
  })
  if (reportTypes.length) {
    observables.push(createReportObservable(reportTypes))
  }
  return mergeObservables.apply(this, observables)
}

function createReportObservable(reportTypes) {
  return new Observable(function (observable) {
    if (!window.ReportingObserver) {
      return
    }

    var handleReports = monitor(function (reports) {
      each(reports, function (report) {
        observable.notify(buildRawReportErrorFromReport(report))
      })
    })

    var observer = new window.ReportingObserver(handleReports, {
      types: reportTypes,
      buffered: true
    })

    observer.observe()
    return function () {
      observer.disconnect()
    }
  })
}

function createCspViolationReportObservable(configuration) {
  return new Observable(function (observable) {
    var _addEventListener = addEventListener(
      document,
      DOM_EVENT.SECURITY_POLICY_VIOLATION,
      function (event) {
        observable.notify(buildRawReportErrorFromCspViolation(event))
      }
    )

    return _addEventListener.stop
  })
}

function buildRawReportErrorFromReport(report) {
  var body = report.body
  var type = report.type
  return buildRawReportError({
    type: body.id,
    message: type + ': ' + body.message,
    originalError: report,
    stack: buildStack(
      body.id,
      body.message,
      body.sourceFile,
      body.lineNumber,
      body.columnNumber
    )
  })
}
function buildRawReportError(partial) {
  return assign(
    {
      startClocks: clocksNow(),
      source: ErrorSource.REPORT,
      handling: ErrorHandling.UNHANDLED
    },
    partial
  )
}
function buildRawReportErrorFromCspViolation(event) {
  var message =
    "'" +
    event.blockedURI +
    "' blocked by '" +
    event.effectiveDirective +
    "' directive"
  return buildRawReportError({
    type: event.effectiveDirective,
    message: RawReportType.cspViolation + ': ' + message,
    originalError: event,
    csp: {
      disposition: event.disposition
    },
    stack: buildStack(
      event.effectiveDirective,
      event.originalPolicy
        ? `${message} of the policy "${safeTruncate(
            event.originalPolicy,
            100,
            '...'
          )}"`
        : 'no policy',
      event.sourceFile,
      event.lineNumber,
      event.columnNumber
    )
  })
}

function buildStack(name, message, sourceFile, lineNumber, columnNumber) {
  return (
    sourceFile &&
    toStackTraceString({
      name: name,
      message: message,
      stack: [
        {
          func: '?',
          url: sourceFile,
          line: lineNumber,
          column: columnNumber
        }
      ]
    })
  )
}
