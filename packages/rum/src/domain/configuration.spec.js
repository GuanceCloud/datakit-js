import { TraceType, DefaultPrivacyLevel } from '@cloudcare/browser-core'
import { display } from '@cloudcare/browser-core'

describe('rum configuration', () => {
  let validateAndBuildRumConfiguration
  let originalBuildEnvVersion

  beforeAll(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'test-version'
    ;({ validateAndBuildRumConfiguration } = require('./configuration'))
  })

  afterAll(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should require an application id', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(
      validateAndBuildRumConfiguration({
        datakitUrl: 'https://datakit.example.com'
      })
    ).toBeUndefined()
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'Application ID is not configured, no RUM data will be collected.'
    )
  })

  it('should build tracing options and rum defaults', () => {
    const configuration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      sampleRate: 80,
      allowedTracingUrls: [
        'https://api.example.com',
        /graphql/,
        {
          match: (url) => url.indexOf('/custom') >= 0,
          traceType: TraceType.JAEGER,
          ignored: true
        }
      ],
      defaultPrivacyLevel: DefaultPrivacyLevel.ALLOW,
      trackInteractions: true,
      sessionReplaySampleRate: 50,
      sessionOnErrorSampleRate: 10,
      sessionReplayOnErrorSampleRate: 20,
      compressIntakeRequests: 1,
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasQuality: 0.5,
      replayCanvasMaxCanvasSize: 1024,
      replayCanvasMaxEncodedBytes: 12345,
      replayCanvasAutoInterval: 2000,
      replayCanvasAutoCooldown: 1500,
      replayCanvasAutoUnchangedBackoff: 4500,
      replayCanvasAutoFailureBackoff: 7000,
      replayCanvasAutoMaxPerRun: 3
    })

    expect(configuration.applicationId).toBe('app-1')
    expect(configuration.sdkVersion).toBe('test-version')
    expect(configuration.trackUserInteractions).toBeTrue()
    expect(configuration.sessionReplaySampleRate).toBe(50)
    expect(configuration.sessionOnErrorSampleRate).toBe(10)
    expect(configuration.sessionReplayOnErrorSampleRate).toBe(20)
    expect(configuration.defaultPrivacyLevel).toBe(DefaultPrivacyLevel.ALLOW)
    expect(configuration.compressIntakeRequests).toBeTrue()
    expect(configuration.replayCanvasEnabled).toBeTrue()
    expect(configuration.replayCanvasMode).toBe('auto')
    expect(configuration.replayCanvasQuality).toBe(0.5)
    expect(configuration.replayCanvasMaxCanvasSize).toBe(1024)
    expect(configuration.replayCanvasMaxEncodedBytes).toBe(12345)
    expect(configuration.replayCanvasAutoInterval).toBe(2000)
    expect(configuration.replayCanvasAutoCooldown).toBe(1500)
    expect(configuration.replayCanvasAutoUnchangedBackoff).toBe(4500)
    expect(configuration.replayCanvasAutoFailureBackoff).toBe(7000)
    expect(configuration.replayCanvasAutoMaxPerRun).toBe(3)
    expect(configuration.replayCanvasFlushImmediately).toBeFalse()
    expect(configuration.allowedTracingUrls.length).toBe(3)
    expect(configuration.allowedTracingUrls[0]).toEqual({
      match: 'https://api.example.com',
      traceType: TraceType.DDTRACE
    })
    expect(configuration.allowedTracingUrls[1].traceType).toBe(
      TraceType.DDTRACE
    )
    expect(configuration.allowedTracingUrls[2].traceType).toBe(
      TraceType.JAEGER
    )
  })

  it('should map sentry-like replay canvas quality presets to internal defaults', () => {
    const lowConfiguration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasQuality: 'low'
    })
    const mediumConfiguration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasQuality: 'medium'
    })
    const highConfiguration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasQuality: 'high'
    })

    expect(lowConfiguration.replayCanvasQuality).toBe(0.25)
    expect(lowConfiguration.replayCanvasAutoInterval).toBe(1500)
    expect(lowConfiguration.replayCanvasAutoCooldown).toBe(3000)
    expect(lowConfiguration.replayCanvasAutoUnchangedBackoff).toBe(5000)
    expect(lowConfiguration.replayCanvasAutoFailureBackoff).toBe(7000)
    expect(lowConfiguration.replayCanvasAutoMaxPerRun).toBe(1)
    expect(lowConfiguration.replayCanvasFlushImmediately).toBeFalse()
    expect(mediumConfiguration.replayCanvasQuality).toBe(0.4)
    expect(mediumConfiguration.replayCanvasAutoInterval).toBe(1000)
    expect(mediumConfiguration.replayCanvasAutoCooldown).toBe(2000)
    expect(mediumConfiguration.replayCanvasAutoUnchangedBackoff).toBe(3000)
    expect(mediumConfiguration.replayCanvasAutoFailureBackoff).toBe(5000)
    expect(mediumConfiguration.replayCanvasAutoMaxPerRun).toBe(2)
    expect(mediumConfiguration.replayCanvasFlushImmediately).toBeFalse()
    expect(highConfiguration.replayCanvasQuality).toBe(0.5)
    expect(highConfiguration.replayCanvasAutoInterval).toBe(700)
    expect(highConfiguration.replayCanvasAutoCooldown).toBe(1400)
    expect(highConfiguration.replayCanvasAutoUnchangedBackoff).toBe(2000)
    expect(highConfiguration.replayCanvasAutoFailureBackoff).toBe(4000)
    expect(highConfiguration.replayCanvasAutoMaxPerRun).toBe(4)
    expect(highConfiguration.replayCanvasFlushImmediately).toBeFalse()
  })

  it('should let explicit auto canvas overrides win over quality presets', () => {
    const configuration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasQuality: 'low',
      replayCanvasAutoInterval: 800,
      replayCanvasAutoCooldown: 900,
      replayCanvasAutoUnchangedBackoff: 1200,
      replayCanvasAutoFailureBackoff: 2500,
      replayCanvasAutoMaxPerRun: 3
    })

    expect(configuration.replayCanvasQuality).toBe(0.25)
    expect(configuration.replayCanvasAutoInterval).toBe(800)
    expect(configuration.replayCanvasAutoCooldown).toBe(900)
    expect(configuration.replayCanvasAutoUnchangedBackoff).toBe(1200)
    expect(configuration.replayCanvasAutoFailureBackoff).toBe(2500)
    expect(configuration.replayCanvasAutoMaxPerRun).toBe(3)
    expect(configuration.replayCanvasFlushImmediately).toBeFalse()
  })

  it('should default replay canvas flush immediately based on replay canvas mode', () => {
    const manualConfiguration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'manual'
    })
    const autoConfiguration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto'
    })
    const explicitOverrideConfiguration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      replayCanvasEnabled: true,
      replayCanvasMode: 'auto',
      replayCanvasFlushImmediately: true
    })

    expect(manualConfiguration.replayCanvasFlushImmediately).toBeTrue()
    expect(autoConfiguration.replayCanvasFlushImmediately).toBeFalse()
    expect(explicitOverrideConfiguration.replayCanvasFlushImmediately).toBeTrue()
  })

  it('should convert legacy tracing origins and warn on precedence conflicts', () => {
    const displayWarnSpy = spyOn(display, 'warn')
    const configuration = validateAndBuildRumConfiguration({
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      allowedTracingUrls: ['https://new.example.com'],
      allowedTracingOrigins: [/old.example.com/],
      traceType: TraceType.W3C_TRACEPARENT
    })

    expect(configuration.allowedTracingUrls).toEqual([
      {
        match: 'https://new.example.com',
        traceType: TraceType.W3C_TRACEPARENT
      }
    ])
    expect(displayWarnSpy).toHaveBeenCalledWith(
      'Both allowedTracingUrls and allowedTracingOrigins (deprecated) have been defined. The parameter allowedTracingUrls will override allowedTracingOrigins.'
    )
  })

  it('should reject invalid excluded activity urls and tracing sample rate', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        excludedActivityUrls: 'invalid'
      })
    ).toBeUndefined()
    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        tracingSampleRate: 101
      })
    ).toBeUndefined()

    expect(displayErrorSpy.calls.count()).toBe(2)
  })

  it('should reject invalid replay canvas options', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasMode: 'invalid'
      })
    ).toBeUndefined()

    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasQuality: 2
      })
    ).toBeUndefined()
    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasQuality: 'ultra'
      })
    ).toBeUndefined()

    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasAutoInterval: 0
      })
    ).toBeUndefined()
    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasAutoCooldown: 0
      })
    ).toBeUndefined()
    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasAutoUnchangedBackoff: 0
      })
    ).toBeUndefined()
    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasAutoFailureBackoff: 0
      })
    ).toBeUndefined()
    expect(
      validateAndBuildRumConfiguration({
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com',
        replayCanvasAutoMaxPerRun: 0
      })
    ).toBeUndefined()

    expect(displayErrorSpy.calls.count()).toBe(8)
  })
})
