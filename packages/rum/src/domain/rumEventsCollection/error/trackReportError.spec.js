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

  it('should stop forwarding csp violation reports after stop is called', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackReportError({}, errorObservable)
    errorObservable.subscribe(subscriber)

    collection.stop()

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

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('should stop forwarding intervention reports after stop is called', () => {
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

    collection.stop()
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

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('should still forward csp violations when ReportingObserver is unavailable', () => {
    window.ReportingObserver = undefined

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
        type: 'script-src'
      })
    )

    collection.stop()
  })

  it('should use the report body id as the emitted report type', () => {
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
          id: 'custom-intervention',
          message: 'preformatted report',
          sourceFile: 'https://example.com/report.js',
          lineNumber: 2,
          columnNumber: 3
        }
      }
    ])

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'custom-intervention',
        message: 'intervention: preformatted report'
      })
    )

    collection.stop()
  })

  it('should leave the emitted report type undefined when the report body id is missing', () => {
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
          message: 'fallback type'
        }
      }
    ])

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: undefined,
        message: 'intervention: fallback type'
      })
    )

    collection.stop()
  })

  it('should build a stack from report source location metadata', () => {
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
          message: 'with source info',
          sourceFile: 'https://example.com/report.js',
          lineNumber: 10,
          columnNumber: 20
        }
      }
    ])

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        stack: jasmine.stringMatching(/report\.js/)
      })
    )

    collection.stop()
  })

  it('should build a csp violation stack without policy details when originalPolicy is missing', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackReportError({}, errorObservable)
    errorObservable.subscribe(subscriber)

    const event = new Event('securitypolicyviolation')
    Object.assign(event, {
      blockedURI: 'https://evil.example/script.js',
      effectiveDirective: 'script-src',
      disposition: 'enforce',
      sourceFile: 'https://example.com/app.js',
      lineNumber: 20,
      columnNumber: 5
    })

    document.dispatchEvent(event)

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        stack: jasmine.stringMatching(/no policy/)
      })
    )

    collection.stop()
  })

  it('should leave the stack undefined when a report has no source location', () => {
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
          message: 'without source info'
        }
      }
    ])

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'intervention',
        stack: undefined
      })
    )

    collection.stop()
  })

  it('should leave the csp stack undefined when no source location is available', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackReportError({}, errorObservable)
    errorObservable.subscribe(subscriber)

    const event = new Event('securitypolicyviolation')
    Object.assign(event, {
      blockedURI: 'https://evil.example/script.js',
      effectiveDirective: 'script-src',
      disposition: 'enforce'
    })

    document.dispatchEvent(event)

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        type: 'script-src',
        stack: undefined
      })
    )

    collection.stop()
  })
})
