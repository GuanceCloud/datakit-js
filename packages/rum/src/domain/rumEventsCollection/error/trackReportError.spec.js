import { Observable } from '@cloudcare/browser-core'
import { trackReportError } from './trackReportError'

describe('trackReportError', () => {
  let originalReportingObserver

  beforeEach(() => {
    originalReportingObserver = window.ReportingObserver
  })

  afterEach(() => {
    window.ReportingObserver = originalReportingObserver
  })

  it('should forward intervention reports to the provided observable', () => {
    let callback
    window.ReportingObserver = function (cb) {
      callback = cb
      this.observe = jasmine.createSpy('observe')
      this.disconnect = jasmine.createSpy('disconnect')
    }

    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackReportError({}, errorObservable)
    errorObservable.subscribe(subscriber)

    callback([
      {
        type: 'intervention',
        body: {
          id: 'intervention',
          message: 'Slow API usage',
          sourceFile: 'https://example.com/app.js',
          lineNumber: 12,
          columnNumber: 34
        }
      }
    ])

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        source: 'report',
        handling: 'unhandled',
        type: 'intervention',
        message: 'intervention: Slow API usage'
      })
    )

    collection.stop()
  })

  it('should forward csp violation reports to the provided observable', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackReportError({}, errorObservable)
    errorObservable.subscribe(subscriber)

    const event = new Event('securitypolicyviolation')
    Object.assign(event, {
      blockedURI: 'https://evil.example/script.js',
      effectiveDirective: 'script-src',
      disposition: 'enforce',
      originalPolicy: "default-src 'self'; script-src 'self'",
      sourceFile: 'https://example.com/app.js',
      lineNumber: 20,
      columnNumber: 5
    })

    document.dispatchEvent(event)

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        source: 'report',
        handling: 'unhandled',
        type: 'script-src',
        message: jasmine.stringMatching(/^csp_violation:/)
      })
    )

    collection.stop()
  })
})
