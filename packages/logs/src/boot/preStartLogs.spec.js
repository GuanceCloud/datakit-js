import { display } from '@cloudcare/browser-core'

describe('preStartLogs', () => {
  let createPreStartStrategy
  let originalBridge
  let originalBuildEnvVersion

  function createValidInitConfiguration(extra) {
    return Object.assign(
      {
        datakitUrl: 'https://datakit.example.com'
      },
      extra
    )
  }

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'logs-test-version'
    ;({ createPreStartStrategy } = require('./preStartLogs'))
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should buffer logs before init and flush them once logs start', () => {
    const getCommonContext = jasmine
      .createSpy('getCommonContext')
      .and.returnValue({ context: { env: 'prod' } })
    const startLogsResult = {
      handleLog: jasmine.createSpy('handleLog')
    }
    const doStartLogs = jasmine
      .createSpy('doStartLogs')
      .and.returnValue(startLogsResult)
    const strategy = createPreStartStrategy(getCommonContext, doStartLogs)

    strategy.handleLog('message', 'info', 'stack')
    strategy.init(createValidInitConfiguration())

    expect(doStartLogs).toHaveBeenCalledWith(
      createValidInitConfiguration(),
      jasmine.objectContaining({
        sdkVersion: 'logs-test-version'
      })
    )
    expect(startLogsResult.handleLog).toHaveBeenCalledWith(
      'message',
      'info',
      'stack',
      { context: { env: 'prod' } },
      jasmine.any(Number)
    )
  })

  it('should override clientToken when the event bridge is available', () => {
    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => '["localhost"]'
    }
    const strategy = createPreStartStrategy(
      jasmine.createSpy('getCommonContext'),
      jasmine.createSpy('doStartLogs').and.returnValue({
        handleLog: jasmine.createSpy('handleLog')
      })
    )

    strategy.init(createValidInitConfiguration())

    expect(strategy.getInitConfiguration()).toEqual(
      jasmine.objectContaining({
        clientToken: 'empty'
      })
    )
  })

  it('should report repeated init calls after logs have started', () => {
    const doStartLogs = jasmine.createSpy('doStartLogs').and.returnValue({
      handleLog: jasmine.createSpy('handleLog')
    })
    const strategy = createPreStartStrategy(
      jasmine.createSpy('getCommonContext'),
      doStartLogs
    )
    const displayErrorSpy = spyOn(display, 'error')

    strategy.init(createValidInitConfiguration())
    strategy.init(createValidInitConfiguration())

    expect(doStartLogs).toHaveBeenCalledTimes(1)
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'DATAFLUX_LOGS is already initialized.'
    )
  })
})
