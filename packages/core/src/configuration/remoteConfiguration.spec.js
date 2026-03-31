import {
  applyRemoteConfiguration,
  buildEndpoint,
  fetchAndApplyRemoteConfiguration,
  fetchRemoteConfiguration,
  getSimpleRemoteConfiguration
} from './remoteConfiguration'
import { display } from '../helper/display'

describe('remoteConfiguration', () => {
  let OriginalXMLHttpRequest

  class FakeXMLHttpRequest extends EventTarget {
    constructor() {
      super()
      this.status = 0
      this.responseText = ''
      this.open = jasmine.createSpy('open')
      this.send = jasmine.createSpy('send')
      FakeXMLHttpRequest.instances.push(this)
    }
  }

  FakeXMLHttpRequest.instances = []

  beforeEach(() => {
    OriginalXMLHttpRequest = window.XMLHttpRequest
    FakeXMLHttpRequest.instances = []
    window.XMLHttpRequest = FakeXMLHttpRequest
  })

  afterEach(() => {
    window.XMLHttpRequest = OriginalXMLHttpRequest
  })

  it('should simplify remote configuration keys for the current application', () => {
    expect(
      getSimpleRemoteConfiguration(
        { applicationId: 'app-id' },
        {
          'R.app-id.sessionSampleRate': 80,
          'R.app-id.service': 'browser-sdk',
          'R.other.env': 'prod',
          'R.app-id.undefinedField': undefined
        }
      )
    ).toEqual({
      sessionSampleRate: 80,
      service: 'browser-sdk',
      'R.other.env': 'prod'
    })
  })

  it('should only apply remote fields with supported types', () => {
    expect(
      applyRemoteConfiguration(
        {
          applicationId: 'app-id',
          service: 'old-service',
          telemetrySampleRate: 20,
          trackViewsManually: false
        },
        {
          'R.app-id.service': 'new-service',
          'R.app-id.telemetrySampleRate': 40,
          'R.app-id.trackViewsManually': true,
          'R.app-id.sessionSampleRate': 'invalid',
          'R.app-id.unknownField': 'ignored'
        }
      )
    ).toEqual({
      applicationId: 'app-id',
      service: 'new-service',
      telemetrySampleRate: 40,
      trackViewsManually: true
    })
  })

  it('should build endpoints from relative paths and site tokens', () => {
    expect(
      buildEndpoint({
        datakitOrigin: '/proxy/',
        applicationId: 'app-id'
      })
    ).toBe(location.origin + '/proxy/v1/env_variable?app_id=app-id')

    expect(
      buildEndpoint({
        site: 'https://browser-intake.example.com/',
        clientToken: 'token-1',
        applicationId: 'app-id'
      })
    ).toBe(
      'https://browser-intake.example.com/v1/env_variable?app_id=app-id&token=token-1&to_headless=true'
    )
  })

  it('should fetch remote configuration content on success', () => {
    const callback = jasmine.createSpy('callback')

    fetchRemoteConfiguration(
      {
        datakitUrl: 'https://example.com',
        applicationId: 'app-id'
      },
      callback
    )

    const xhr = FakeXMLHttpRequest.instances[0]
    expect(xhr.open).toHaveBeenCalledWith(
      'GET',
      'https://example.com/v1/env_variable?app_id=app-id'
    )
    expect(xhr.send).toHaveBeenCalled()

    xhr.status = 200
    xhr.responseText = JSON.stringify({
      content: { 'R.app-id.service': 'browser-sdk' }
    })
    xhr.dispatchEvent(new Event('load'))

    expect(callback).toHaveBeenCalledWith({
      'R.app-id.service': 'browser-sdk'
    })
  })

  it('should return an empty configuration and report fetch errors', () => {
    const callback = jasmine.createSpy('callback')
    const displayErrorSpy = spyOn(display, 'error')

    fetchRemoteConfiguration(
      {
        datakitUrl: 'https://example.com',
        applicationId: 'app-id'
      },
      callback
    )

    FakeXMLHttpRequest.instances[0].dispatchEvent(new Event('error'))

    expect(callback).toHaveBeenCalledWith({})
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'Error fetching the remote configuration.'
    )
  })

  it('should combine fetch and apply steps for supported remote fields', () => {
    const callback = jasmine.createSpy('callback')

    fetchAndApplyRemoteConfiguration(
      {
        applicationId: 'app-id',
        datakitUrl: 'https://example.com',
        service: 'old-service',
        telemetrySampleRate: 20
      },
      callback
    )

    const xhr = FakeXMLHttpRequest.instances[0]
    xhr.status = 200
    xhr.responseText = JSON.stringify({
      content: {
        'R.app-id.service': 'new-service',
        'R.app-id.telemetrySampleRate': 30,
        'R.app-id.invalid': { nested: true }
      }
    })
    xhr.dispatchEvent(new Event('load'))

    expect(callback).toHaveBeenCalledWith(
      {
        applicationId: 'app-id',
        datakitUrl: 'https://example.com',
        service: 'new-service',
        telemetrySampleRate: 30
      },
      {
        service: 'new-service',
        telemetrySampleRate: 30,
        invalid: { nested: true }
      }
    )
  })
})
