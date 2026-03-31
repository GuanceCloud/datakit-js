import {
  initReportObservable,
  RawReportType
} from './reportObservable'

describe('reportObservable', () => {
  let originalReportingObserver

  beforeEach(() => {
    originalReportingObserver = window.ReportingObserver
  })

  afterEach(() => {
    window.ReportingObserver = originalReportingObserver
  })

  it('should collect reports from the ReportingObserver API', () => {
    let callback
    const observe = jasmine.createSpy('observe')
    const disconnect = jasmine.createSpy('disconnect')

    window.ReportingObserver = function (cb, options) {
      callback = cb
      this.observe = observe
      this.disconnect = disconnect
      this.options = options
    }

    const subscriber = jasmine.createSpy('subscriber')
    const observable = initReportObservable({}, [RawReportType.intervention])
    const subscription = observable.subscribe(subscriber)

    callback([
      {
        type: RawReportType.intervention,
        body: {
          id: 'intervention',
          message: 'Slow API usage',
          sourceFile: 'https://example.com/app.js',
          lineNumber: 12,
          columnNumber: 34
        }
      }
    ])

    expect(observe).toHaveBeenCalled()
    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        source: 'report',
        handling: 'unhandled',
        type: 'intervention',
        message: 'intervention: Slow API usage',
        stack: jasmine.stringMatching(/https:\/\/example\.com\/app\.js:12:34/)
      })
    )

    subscription.unsubscribe()
    expect(disconnect).toHaveBeenCalled()
  })

  it('should collect CSP violation events', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = initReportObservable({}, [RawReportType.cspViolation])
    const subscription = observable.subscribe(subscriber)

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
        message: jasmine.stringMatching(/^csp_violation:/),
        csp: {
          disposition: 'enforce'
        }
      })
    )

    subscription.unsubscribe()
  })
})
