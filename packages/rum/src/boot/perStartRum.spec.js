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
      startSession: jasmine.createSpy('startSession'),
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
    strategy.startSession({ sessionSampleRate: 100 })
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
    expect(startRumResult.startSession).toHaveBeenCalledWith({
      sessionSampleRate: 100
    })
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

  it('should initialize plugins before remote configuration and preserve manual views', () => {
    const OriginalXMLHttpRequest = window.XMLHttpRequest
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
    window.XMLHttpRequest = FakeXMLHttpRequest

    try {
      let strategy
      const onInit = jasmine.createSpy('onInit').and.callFake(function (
        initConfiguration
      ) {
        initConfiguration.trackViewsManually = true
        strategy.startView({ name: 'Framework initial view' })
      })
      const doStartRum = jasmine
        .createSpy('doStartRum')
        .and.returnValue({})
      strategy = createPreStartStrategy(
        { onInit },
        jasmine.createSpy('getCommonContext'),
        doStartRum
      )
      const plugin = { name: 'router-plugin' }
      const displayErrorSpy = spyOn(display, 'error')
      const initConfiguration = createValidInitConfiguration({
        plugins: [plugin],
        remoteConfiguration: true
      })
      const ignoredInitConfiguration = createValidInitConfiguration({
        applicationId: 'ignored-app',
        plugins: [plugin],
        remoteConfiguration: true
      })

      strategy.init(initConfiguration, {})
      strategy.init(ignoredInitConfiguration, {})

      expect(onInit).toHaveBeenCalledTimes(1)
      expect(doStartRum).not.toHaveBeenCalled()
      expect(FakeXMLHttpRequest.instances.length).toBe(1)
      expect(strategy.getInitConfiguration()).toBe(initConfiguration)
      expect(displayErrorSpy).toHaveBeenCalledWith(
        'DATAFLUX_RUM is already initialized.'
      )

      const xhr = FakeXMLHttpRequest.instances[0]
      xhr.status = 200
      xhr.responseText = JSON.stringify({
        content: {
          'R.app-1.trackViewsManually': false
        }
      })
      xhr.dispatchEvent(new Event('load'))

      expect(doStartRum).toHaveBeenCalledTimes(1)
      expect(doStartRum.calls.mostRecent().args[0].trackViewsManually).toBeTrue()
      expect(doStartRum.calls.mostRecent().args[2]).toEqual({
        name: 'Framework initial view'
      })
    } finally {
      window.XMLHttpRequest = OriginalXMLHttpRequest
    }
  })

  it('should allow retrying init after invalid configuration', () => {
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue({})
    const strategy = createPreStartStrategy(
      {},
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )

    strategy.init({ datakitUrl: 'https://datakit.example.com' })
    strategy.init(createValidInitConfiguration())

    expect(doStartRum).toHaveBeenCalledTimes(1)
  })

  it('should reject reentrant init calls from a plugin', () => {
    let strategy
    const nestedInitConfiguration = createValidInitConfiguration({
      applicationId: 'nested-app'
    })
    const onInit = jasmine.createSpy('onInit').and.callFake(function () {
      strategy.init(nestedInitConfiguration, {})
    })
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue({})
    const displayErrorSpy = spyOn(display, 'error')
    strategy = createPreStartStrategy(
      { onInit },
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )
    const initConfiguration = createValidInitConfiguration()

    strategy.init(initConfiguration, {})

    expect(onInit).toHaveBeenCalledTimes(1)
    expect(doStartRum).toHaveBeenCalledTimes(1)
    expect(strategy.getInitConfiguration()).toBe(initConfiguration)
    expect(displayErrorSpy).toHaveBeenCalledWith(
      'DATAFLUX_RUM is already initialized.'
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

  it('should not initialize plugins twice while waiting for a manual view', () => {
    const onInit = jasmine.createSpy('onInit').and.callFake(function (
      initConfiguration
    ) {
      initConfiguration.trackViewsManually = true
    })
    const doStartRum = jasmine
      .createSpy('doStartRum')
      .and.returnValue({})
    const strategy = createPreStartStrategy(
      { onInit },
      jasmine.createSpy('getCommonContext'),
      doStartRum
    )
    const initConfiguration = createValidInitConfiguration({
      plugins: [{ name: 'router-plugin' }]
    })

    strategy.init(initConfiguration, {})
    strategy.init(initConfiguration, {})

    expect(onInit).toHaveBeenCalledTimes(1)
    expect(doStartRum).not.toHaveBeenCalled()

    strategy.startView({ name: 'Initial route' })

    expect(doStartRum).toHaveBeenCalledTimes(1)
    expect(doStartRum.calls.mostRecent().args[2]).toEqual({
      name: 'Initial route'
    })
  })
})
