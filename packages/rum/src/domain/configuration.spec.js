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
      compressIntakeRequests: 1
    })

    expect(configuration.applicationId).toBe('app-1')
    expect(configuration.sdkVersion).toBe('test-version')
    expect(configuration.trackUserInteractions).toBeTrue()
    expect(configuration.sessionReplaySampleRate).toBe(50)
    expect(configuration.sessionOnErrorSampleRate).toBe(10)
    expect(configuration.sessionReplayOnErrorSampleRate).toBe(20)
    expect(configuration.defaultPrivacyLevel).toBe(DefaultPrivacyLevel.ALLOW)
    expect(configuration.compressIntakeRequests).toBeTrue()
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
})
