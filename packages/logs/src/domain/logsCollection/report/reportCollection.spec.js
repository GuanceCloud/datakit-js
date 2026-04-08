import { LifeCycle, LifeCycleEventType, RawReportType } from '@cloudcare/browser-core'
import { startReportCollection } from './reportCollection'

describe('logs/reportCollection', () => {
  let OriginalReportingObserver

  beforeEach(() => {
    OriginalReportingObserver = window.ReportingObserver
  })

  afterEach(() => {
    window.ReportingObserver = OriginalReportingObserver
  })

  it('should collect report observer errors as error-level raw logs', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')
    let observerCallback
    const disconnect = jasmine.createSpy('disconnect')

    window.ReportingObserver = function (callback) {
      observerCallback = callback
      return {
        observe: jasmine.createSpy('observe'),
        disconnect
      }
    }

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    const collection = startReportCollection(
      {
        forwardReports: [RawReportType.intervention]
      },
      lifeCycle
    )

    observerCallback([
      {
        type: 'intervention',
        body: {
          id: 'intervention',
          message: 'feature policy blocked',
          sourceFile: 'https://example.com/app.js',
          lineNumber: 12,
          columnNumber: 5
        }
      }
    ])

    expect(rawLogCollected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message: 'intervention: feature policy blocked',
          origin: 'report',
          status: 'error',
          error: jasmine.objectContaining({
            handling: 'unhandled',
            kind: 'intervention',
            stack: jasmine.any(String)
          })
        })
      })
    )

    collection.stop()

    expect(disconnect).toHaveBeenCalled()
  })

  it('should collect csp violation reports through DOM events', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    const collection = startReportCollection(
      {
        forwardReports: [RawReportType.cspViolation]
      },
      lifeCycle
    )

    const event = new Event('securitypolicyviolation')
    event.blockedURI = 'https://evil.example.com/script.js'
    event.effectiveDirective = 'script-src'
    event.originalPolicy = "default-src 'self'"
    event.sourceFile = 'https://example.com/app.js'
    event.lineNumber = 10
    event.columnNumber = 2
    event.disposition = 'enforce'
    document.dispatchEvent(event)

    expect(rawLogCollected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message:
            "csp_violation: 'https://evil.example.com/script.js' blocked by 'script-src' directive",
          origin: 'report',
          status: 'error'
        })
      })
    )

    collection.stop()
  })

  it('should turn deprecation reports into warn logs with source file information', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')
    let observerCallback

    window.ReportingObserver = function (callback) {
      observerCallback = callback
      return {
        observe: jasmine.createSpy('observe'),
        disconnect: jasmine.createSpy('disconnect')
      }
    }

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    const collection = startReportCollection(
      {
        forwardReports: [RawReportType.deprecation]
      },
      lifeCycle
    )

    observerCallback([
      {
        type: 'deprecation',
        body: {
          id: 'deprecation',
          message: 'legacy API',
          sourceFile: 'https://example.com/app.js',
          lineNumber: 12,
          columnNumber: 5
        }
      }
    ])

    expect(rawLogCollected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message:
            'deprecation: legacy API Found in https://example.com/app.js:12:5',
          origin: 'report',
          status: 'warn',
          error: undefined
        })
      })
    )

    collection.stop()
  })
})
