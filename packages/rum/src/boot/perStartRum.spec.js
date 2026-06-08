import { display } from '@cloudcare/browser-core'

describe('preStartRum', () => {
  let createPreStartStrategy
  let originalBridge
  let originalSyntheticsInjectsRum
  let originalBuildEnvVersion

  function createValidInitConfiguration(extra) {
    return Object.assign(
      {
        applicationId: 'app-1',
        datakitUrl: 'https://datakit.example.com'
      },
      extra
    )
  }

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
    originalSyntheticsInjectsRum = window._GUANCE_SYNTHETICS_INJECTS_RUM
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'test-version'
    ;({ createPreStartStrategy } = require('./perStartRum'))
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
    window._GUANCE_SYNTHETICS_INJECTS_RUM = originalSyntheticsInjectsRum
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should buffer calls before init and use the first manual startView as initial view options', () => {
    const getCommonContext = jasmine
      .createSpy('getCommonContext')
      .and.returnValue({ view: { id: 'view-1' } })
    const startRumResult = {
      addAction: jasmine.createSpy('addAction'),
      addError: jasmine.createSpy('addError'),
      addResource: jasmine.createSpy('addResource'),
      addTiming: jasmine.createSpy('addTiming'),
      setForcedSession: jasmine.createSpy('setForcedSession'),
      startView: jasmine.createSpy('startView'),
      setViewName: jasmine.createSpy('setViewName'),
      setViewContext: jasmine.createSpy('setViewContext'),
      setViewContextProperty: jasmine.createSpy('setViewContextProperty')
    }
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue(startRumResult)
    const strategy = createPreStartStrategy({}, getCommonContext, doStartRum)

    strategy.startView({ name: 'Checkout' })
    strategy.addAction({ name: 'submit' })
    strategy.addResource({ url: '/resource' })
    strategy.addError({ message: 'boom' })
    strategy.addTiming('ready', 123)
    strategy.setForcedSession()
    strategy.setViewName('Ignored until post-start strategy swap')

    strategy.init(
      createValidInitConfiguration({
        trackViewsManually: true
      })
    )

    expect(doStartRum).toHaveBeenCalledTimes(1)
    expect(doStartRum.calls.mostRecent().args[2]).toEqual({
      name: 'Checkout'
    })
    expect(startRumResult.startView).not.toHaveBeenCalled()
    expect(startRumResult.addAction).toHaveBeenCalledWith(
      { name: 'submit' },
      { view: { id: 'view-1' } }
    )
    expect(startRumResult.addResource).toHaveBeenCalledWith(
      { url: '/resource' },
      { view: { id: 'view-1' } }
    )
    expect(startRumResult.addError).toHaveBeenCalledWith(
      { message: 'boom' },
      { view: { id: 'view-1' } }
    )
    expect(startRumResult.addTiming).toHaveBeenCalledWith('ready', 123)
    expect(startRumResult.setForcedSession).toHaveBeenCalled()
    expect(startRumResult.setViewName).toHaveBeenCalledWith(
      'Ignored until post-start strategy swap'
    )
    expect(getCommonContext.calls.count()).toBe(3)
  })

  it('should ignore init when synthetics will inject rum and still expose the init configuration', () => {
    window._GUANCE_SYNTHETICS_INJECTS_RUM = true
    const doStartRum = jasmine.createSpy('doStartRum')
    const strategy = createPreStartStrategy(
      { ignoreInitIfSyntheticsWillInjectRum: true },
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )
    const initConfiguration = createValidInitConfiguration()

    strategy.init(initConfiguration)

    expect(doStartRum).not.toHaveBeenCalled()
    expect(strategy.getInitConfiguration()).toBe(initConfiguration)
  })

  it('should override configuration for event bridge sessions', () => {
    window.FTWebViewJavascriptBridge = {
      getAllowedWebViewHosts: () => JSON.stringify(['localhost']),
      getPrivacyLevel: () => 'allow'
    }
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue({})
    const strategy = createPreStartStrategy(
      {},
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )

    strategy.init(
      createValidInitConfiguration({
        defaultPrivacyLevel: undefined
      })
    )

    expect(doStartRum).toHaveBeenCalled()
    expect(doStartRum.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        applicationId: '00000000-aaaa-0000-aaaa-000000000000',
        sessionSampleRate: 100,
        defaultPrivacyLevel: 'allow'
      })
    )
    expect(strategy.getInitConfiguration()).toEqual(
      jasmine.objectContaining({
        applicationId: '00000000-aaaa-0000-aaaa-000000000000',
        clientToken: 'empty'
      })
    )
  })

  it('should apply the entry configuration override before starting rum', () => {
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue({})
    const strategy = createPreStartStrategy(
      {
        overrideInitConfiguration: function (configuration) {
          return Object.assign({}, configuration, {
            sessionReplaySampleRate: 0,
            sessionReplayOnErrorSampleRate: 0,
            compressIntakeRequests: false
          })
        }
      },
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )

    strategy.init(
      createValidInitConfiguration({
        sessionReplaySampleRate: 100,
        sessionReplayOnErrorSampleRate: 100,
        compressIntakeRequests: true
      })
    )

    expect(doStartRum).toHaveBeenCalled()
    expect(doStartRum.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        sessionReplaySampleRate: 0,
        sessionReplayOnErrorSampleRate: 0,
        compressIntakeRequests: false
      })
    )
  })

  it('should report an already initialized error on repeated init calls', () => {
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue({})
    const strategy = createPreStartStrategy(
      {},
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )
    const displayErrorSpy = spyOn(display, 'error')

    strategy.init(createValidInitConfiguration())
    strategy.init(createValidInitConfiguration())

    expect(doStartRum).toHaveBeenCalledTimes(1)
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'DATAFLUX_RUM is already initialized.'
    )
  })
})
