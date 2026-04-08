import { ConsoleApiName, RawReportType } from '@cloudcare/browser-core'
import { display } from '@cloudcare/browser-core'

describe('logs configuration', () => {
  let validateAndBuildLogsConfiguration
  let validateAndBuildForwardOption
  let originalBuildEnvVersion

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'logs-test-version'
    ;({
      validateAndBuildLogsConfiguration,
      validateAndBuildForwardOption
    } = require('./configuration'))
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should build logs defaults and force console error forwarding when requested', () => {
    const configuration = validateAndBuildLogsConfiguration({
      datakitUrl: 'https://datakit.example.com',
      forwardConsoleLogs: [ConsoleApiName.warn],
      forwardErrorsToLogs: true
    })

    expect(configuration).toEqual(
      jasmine.objectContaining({
        forwardErrorsToLogs: true,
        forwardConsoleLogs: [ConsoleApiName.warn, ConsoleApiName.error],
        forwardReports: [],
        sdkVersion: 'logs-test-version',
        sdkName: 'df_web_logs_sdk'
      })
    )
  })

  it('should support "all" and unique arrays for forward options', () => {
    expect(
      validateAndBuildForwardOption(
        'all',
        [ConsoleApiName.log, ConsoleApiName.warn],
        'Forward Console Logs'
      )
    ).toEqual([ConsoleApiName.log, ConsoleApiName.warn])

    expect(
      validateAndBuildForwardOption(
        [RawReportType.cspViolation, RawReportType.cspViolation],
        [RawReportType.cspViolation, RawReportType.intervention],
        'Forward Reports'
      )
    ).toEqual([RawReportType.cspViolation])
  })

  it('should reject invalid forward options', () => {
    const displayErrorSpy = spyOn(display, 'error')

    expect(
      validateAndBuildForwardOption(
        ['not-valid'],
        [ConsoleApiName.log],
        'Forward Console Logs'
      )
    ).toBeUndefined()

    expect(displayErrorSpy).toHaveBeenCalled()
  })
})
