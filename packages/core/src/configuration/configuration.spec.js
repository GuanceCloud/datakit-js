import {
  DefaultPrivacyLevel,
  validateAndBuildConfiguration,
  validatePostRequestRequireParamsConfiguration
} from './configuration'
import { display } from '../helper/display'
import { ONE_KIBI_BYTE } from '../helper/byteUtils'

describe('configuration', () => {
  it('should expose privacy level constants', () => {
    expect(DefaultPrivacyLevel).toEqual({
      ALLOW: 'allow',
      MASK: 'mask',
      MASK_USER_INPUT: 'mask-user-input'
    })
  })

  it('should reject invalid sample rate values', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(
      validateAndBuildConfiguration({
        datakitUrl: 'https://datakit.example.com',
        sampleRate: 101
      })
    ).toBeUndefined()
    expect(
      validateAndBuildConfiguration({
        datakitUrl: 'https://datakit.example.com',
        sessionSampleRate: -1
      })
    ).toBeUndefined()
    expect(
      validateAndBuildConfiguration({
        datakitUrl: 'https://datakit.example.com',
        telemetrySampleRate: 120
      })
    ).toBeUndefined()

    expect(displayErrorSpy.calls.count()).toBe(3)
  })

  it('should build defaults and wrap beforeSend with catchUserErrors', () => {
    const displayErrorSpy = spyOn(display, 'error')
    const beforeSend = jasmine
      .createSpy('beforeSend')
      .and.throwError('before-send-failed')

    const configuration = validateAndBuildConfiguration({
      datakitUrl: 'https://datakit.example.com',
      beforeSend,
      sampleRate: 80,
      telemetryEnabled: true,
      storeContextsToLocal: true,
      sendContentTypeByJson: true,
      retryMaxSize: 10
    })

    expect(configuration.sessionSampleRate).toBe(80)
    expect(configuration.telemetrySampleRate).toBe(100)
    expect(configuration.telemetryEnabled).toBeTrue()
    expect(configuration.silentMultipleInit).toBeFalse()
    expect(configuration.batchBytesLimit).toBe(16 * ONE_KIBI_BYTE)
    expect(configuration.messageBytesLimit).toBe(256 * ONE_KIBI_BYTE)
    expect(configuration.resourceUrlLimit).toBe(5 * ONE_KIBI_BYTE)
    expect(configuration.storeContextsToLocal).toBeTrue()
    expect(configuration.sendContentTypeByJson).toBeTrue()
    expect(configuration.retryMaxSize).toBe(10)
    expect(configuration.isOpenWay).toBeFalsy()

    configuration.beforeSend({ type: 'view' })

    expect(beforeSend).toHaveBeenCalledWith({ type: 'view' })
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'beforeSend threw an error:',
      jasmine.any(Error)
    )
  })

  it('should mark openway configurations and keep explicit defaults', () => {
    const configuration = validateAndBuildConfiguration({
      site: 'https://browser-intake.example.com',
      clientToken: 'token-1',
      telemetrySampleRate: 40,
      telemetryEnabled: false,
      silentMultipleInit: 1,
      retryMaxSize: 0
    })

    expect(configuration.isOpenWay).toBe('token-1')
    expect(configuration.telemetrySampleRate).toBe(40)
    expect(configuration.telemetryEnabled).toBeFalse()
    expect(configuration.silentMultipleInit).toBeTrue()
    expect(configuration.retryMaxSize).toBe(0)
  })

  it('should validate required post request configuration params', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(validatePostRequestRequireParamsConfiguration({})).toBeFalse()
    expect(
      validatePostRequestRequireParamsConfiguration({
        site: 'https://browser-intake.example.com'
      })
    ).toBeFalse()
    expect(
      validatePostRequestRequireParamsConfiguration({
        datakitOrigin: '/proxy'
      })
    ).toBeTrue()
    expect(
      validatePostRequestRequireParamsConfiguration({
        site: 'https://browser-intake.example.com',
        clientToken: 'token-1'
      })
    ).toBeTrue()

    expect(displayErrorSpy.calls.argsFor(0)[0]).toContain(
      'datakitOrigin or site is not configured'
    )
    expect(displayErrorSpy.calls.argsFor(1)[0]).toContain(
      'clientToken is not configured'
    )
  })
})
