import {
  computeTransportConfiguration,
  isIntakeRequest,
  trim
} from './transportConfiguration'

describe('transportConfiguration', () => {
  it('should trim surrounding whitespace', () => {
    expect(trim('  /proxy/  ')).toBe('/proxy/')
  })

  it('should compute endpoints from a relative datakit origin', () => {
    const configuration = computeTransportConfiguration({
      datakitOrigin: '/proxy/',
      applicationId: 'app-id'
    })

    expect(configuration.rumEndpoint).toBe(
      location.origin + '/proxy/v1/write/rum'
    )
    expect(configuration.logsEndpoint).toBe(
      location.origin + '/proxy/v1/write/logging'
    )
    expect(configuration.sessionReplayEndPoint).toBe(
      location.origin + '/proxy/v1/write/rum/replay'
    )
  })

  it('should append token and headless query parameters for site endpoints', () => {
    const configuration = computeTransportConfiguration({
      site: 'https://browser-intake.example.com/',
      clientToken: 'token-1'
    })

    expect(configuration.rumEndpoint).toBe(
      'https://browser-intake.example.com/v1/write/rum?token=token-1&to_headless=true'
    )
    expect(configuration.logsEndpoint).toBe(
      'https://browser-intake.example.com/v1/write/logging?token=token-1&to_headless=true'
    )
    expect(configuration.sessionReplayEndPoint).toBe(
      'https://browser-intake.example.com/v1/write/rum/replay?token=token-1&to_headless=true'
    )
  })

  it('should only keep custom predicates when they return booleans', () => {
    const isIntakeUrl = jasmine
      .createSpy('isIntakeUrl')
      .and.returnValue(true)
    const isServerError = jasmine
      .createSpy('isServerError')
      .and.returnValue(false)

    const configuration = computeTransportConfiguration({
      datakitUrl: 'https://datakit.example.com',
      isIntakeUrl,
      isServerError
    })

    expect(configuration.isIntakeUrl).toBe(isIntakeUrl)
    expect(configuration.isServerError).toBe(isServerError)

    const fallbackConfiguration = computeTransportConfiguration({
      datakitUrl: 'https://datakit.example.com',
      isIntakeUrl: () => 'yes',
      isServerError: () => 'no'
    })

    expect(fallbackConfiguration.isIntakeUrl('https://test')).toBeFalse()
    expect(fallbackConfiguration.isServerError({ status: 500 })).toBeFalse()
  })

  it('should detect intake requests from configured endpoints and custom rules', () => {
    const configuration = computeTransportConfiguration({
      datakitUrl: 'https://datakit.example.com',
      isIntakeUrl: function (url) {
        if (url === undefined) {
          return true
        }
        return url.indexOf('custom-intake') !== -1
      }
    })

    expect(
      isIntakeRequest('https://datakit.example.com/v1/write/rum?x=1', configuration)
    ).toBeTrue()
    expect(
      isIntakeRequest(
        'https://datakit.example.com/v1/write/logging?x=1',
        configuration
      )
    ).toBeTrue()
    expect(
      isIntakeRequest(
        'https://datakit.example.com/v1/write/rum/replay?x=1',
        configuration
      )
    ).toBeTrue()
    expect(isIntakeRequest('https://custom-intake.example.com', configuration)).toBeTrue()
    expect(isIntakeRequest('https://other.example.com', configuration)).toBeFalse()
  })
})
