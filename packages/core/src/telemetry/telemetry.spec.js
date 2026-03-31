import {
  addTelemetryConfiguration,
  addTelemetryDebug,
  addTelemetryError,
  addTelemetryUsage,
  drainPreStartTelemetry,
  formatError,
  resetTelemetry,
  scrubCustomerFrames,
  startFakeTelemetry,
  startTelemetry
} from './telemetry'
import { resetMonitor, setDebugMode } from '../helper/monitor'
import { TelemetryStatusType, TelemetryType } from './types'

describe('telemetry', () => {
  let originalBuildEnvVersion

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'test-version'
  })

  afterEach(() => {
    resetTelemetry()
    resetMonitor()
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should collect telemetry events with the fake telemetry sink', () => {
    const events = startFakeTelemetry()

    addTelemetryConfiguration({ sampleRate: 100 })
    addTelemetryUsage({ feature: 'session-replay' })
    addTelemetryDebug('debug message', { origin: 'spec' })

    expect(events).toEqual([
      {
        type: TelemetryType.configuration,
        configuration: { sampleRate: 100 }
      },
      {
        type: TelemetryType.usage,
        usage: { feature: 'session-replay' }
      },
      {
        type: TelemetryType.log,
        message: 'debug message',
        status: TelemetryStatusType.debug,
        origin: 'spec'
      }
    ])
  })

  it('should drain pre-start telemetry into the started service and deduplicate repeated events', () => {
    addTelemetryUsage({ action: 'before-start' })

    const telemetry = startTelemetry('browser-rum-sdk', {
      telemetryEnabled: true,
      telemetrySampleRate: 100,
      maxTelemetryEventsPerPage: 5
    })
    const received = []
    telemetry.setContextProvider(() => ({ context: { env: 'test' } }))
    telemetry.observable.subscribe((event) => received.push(event))

    drainPreStartTelemetry()
    addTelemetryConfiguration({ mode: 'on' })
    addTelemetryConfiguration({ mode: 'on' })

    expect(telemetry.enabled).toBeTrue()
    expect(received.length).toBe(2)
    expect(received[0]).toEqual(
      jasmine.objectContaining({
        type: 'telemetry',
        service: 'browser-rum-sdk',
        source: 'browser',
        context: { env: 'test' },
        telemetry: jasmine.objectContaining({
          type: TelemetryType.usage,
          usage: { action: 'before-start' }
        })
      })
    )
    expect(received[1].telemetry).toEqual(
      jasmine.objectContaining({
        type: TelemetryType.configuration,
        configuration: { mode: 'on' }
      })
    )
  })

  it('should stop telemetry collection when telemetry is disabled by configuration', () => {
    const telemetry = startTelemetry('browser-logs-sdk', {
      telemetryEnabled: false,
      telemetrySampleRate: 100,
      maxTelemetryEventsPerPage: 5
    })
    const next = jasmine.createSpy('next')
    telemetry.observable.subscribe(next)

    addTelemetryUsage({ action: 'disabled' })

    expect(telemetry.enabled).toBeFalse()
    expect(next).not.toHaveBeenCalled()
  })

  it('should format error and non-error telemetry payloads', () => {
    const nonError = formatError({ boom: true })

    expect(nonError).toEqual({
      error: {
        stack: 'No stack, consider using an instance of Error'
      },
      message: 'Uncaught {"boom":true}'
    })

    const error = formatError(new Error('boom'))
    expect(error.message).toBe('boom')
    expect(error.error.kind).toBe('Error')
    expect(error.error.stack).toContain('Error: boom')
  })

  it('should scrub customer frames and keep only allowed urls', () => {
    const stackTrace = {
      name: 'Error',
      message: 'boom',
      stack: [
        { url: 'https://static.guance.com/app.js', func: 'keep' },
        { url: 'http://localhost:3000/app.js', func: 'keep-local' },
        { url: '<anonymous>', func: 'keep-anon' },
        { url: 'https://customer.example.com/app.js', func: 'drop' }
      ]
    }

    const scrubbed = scrubCustomerFrames(stackTrace)

    expect(scrubbed.stack).toEqual([
      { url: 'https://static.guance.com/app.js', func: 'keep' },
      { url: 'http://localhost:3000/app.js', func: 'keep-local' },
      { url: '<anonymous>', func: 'keep-anon' }
    ])
  })

  it('should allow debug telemetry to flow without requiring display assertions', () => {
    const telemetry = startTelemetry('browser-rum-sdk', {
      telemetryEnabled: true,
      telemetrySampleRate: 100,
      maxTelemetryEventsPerPage: 5
    })
    const next = jasmine.createSpy('next')
    telemetry.observable.subscribe(next)
    setDebugMode(true)

    addTelemetryDebug('debug event', { from: 'spec' })
    addTelemetryError(new Error('telemetry-boom'))

    expect(next.calls.count()).toBe(2)
    expect(next.calls.argsFor(0)[0].telemetry).toEqual(
      jasmine.objectContaining({
        type: TelemetryType.log,
        status: TelemetryStatusType.debug,
        message: 'debug event',
        from: 'spec'
      })
    )
    expect(next.calls.argsFor(1)[0].telemetry).toEqual(
      jasmine.objectContaining({
        type: TelemetryType.log,
        status: TelemetryStatusType.error,
        message: 'telemetry-boom'
      })
    )
  })
})
