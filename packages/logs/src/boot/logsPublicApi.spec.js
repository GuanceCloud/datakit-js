describe('logsPublicApi', () => {
  let makeLogsPublicApi
  let originalBuildEnvVersion

  function createValidInitConfiguration(extra) {
    return Object.assign(
      {
        clientToken: 'token',
        datakitUrl: 'https://datakit.example.com'
      },
      extra
    )
  }

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'logs-public-api-version'
    ;({ makeLogsPublicApi } = require('./logsPublicApi'))
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should use the buffered common context when logs start and expose context APIs', () => {
    const startLogsResult = {
      getInternalContext: jasmine
        .createSpy('getInternalContext')
        .and.returnValue({ session: { id: 'session-1' } }),
      handleLog: jasmine.createSpy('handleLog'),
      stop: jasmine.createSpy('stop')
    }
    const startLogsImpl = jasmine
      .createSpy('startLogsImpl')
      .and.returnValue(startLogsResult)
    const logsPublicApi = makeLogsPublicApi(startLogsImpl)

    logsPublicApi.setGlobalContextProperty('account', 'pro')
    logsPublicApi.setUser({
      id: 'user-1',
      email: 'user@example.com'
    })
    logsPublicApi.logger.info('boot log')
    logsPublicApi.init(createValidInitConfiguration())

    const getCommonContext = startLogsImpl.calls.mostRecent().args[2]
    expect(getCommonContext()).toEqual({
      view: {
        referrer: document.referrer,
        url: window.location.href
      },
      context: { account: 'pro' },
      user: {
        id: 'user-1',
        email: 'user@example.com'
      }
    })
    expect(startLogsResult.handleLog).toHaveBeenCalledWith(
      jasmine.objectContaining({
        message: 'boot log',
        status: 'info'
      }),
      jasmine.any(Object),
      jasmine.any(String),
      jasmine.objectContaining({
        context: { account: 'pro' },
        user: {
          id: 'user-1',
          email: 'user@example.com'
        }
      }),
      jasmine.any(Number)
    )
    expect(logsPublicApi.getGlobalContext()).toEqual({ account: 'pro' })
    expect(logsPublicApi.getUser()).toEqual({
      id: 'user-1',
      email: 'user@example.com'
    })
    expect(logsPublicApi.getInternalContext()).toEqual({
      session: { id: 'session-1' }
    })
  })

  it('should delegate post-start logger operations to the started strategy', () => {
    const startLogsResult = {
      getInternalContext: jasmine.createSpy('getInternalContext'),
      handleLog: jasmine.createSpy('handleLog'),
      stop: jasmine.createSpy('stop')
    }
    const logsPublicApi = makeLogsPublicApi(
      jasmine.createSpy('startLogsImpl').and.returnValue(startLogsResult)
    )

    logsPublicApi.init(createValidInitConfiguration())
    logsPublicApi.logger.warn('request failed', { requestId: 'req-1' })

    expect(startLogsResult.handleLog).toHaveBeenCalledWith(
      jasmine.objectContaining({
        message: 'request failed',
        status: 'warn',
        context: jasmine.objectContaining({
          requestId: 'req-1'
        })
      }),
      logsPublicApi.logger,
      jasmine.any(String)
    )
  })

  it('should clone init configuration and support user/global context mutations', () => {
    const logsPublicApi = makeLogsPublicApi(
      jasmine.createSpy('startLogsImpl').and.returnValue({
        getInternalContext: jasmine.createSpy('getInternalContext'),
        handleLog: jasmine.createSpy('handleLog'),
        stop: jasmine.createSpy('stop')
      })
    )
    const initConfiguration = createValidInitConfiguration({
      sampleRate: 80
    })

    logsPublicApi.init(initConfiguration)
    logsPublicApi.setGlobalContext({ env: 'prod' })
    logsPublicApi.removeGlobalContextProperty('missing')
    logsPublicApi.setUserProperty('role', 'admin')
    logsPublicApi.removeUserProperty('role')

    const clonedConfiguration = logsPublicApi.getInitConfiguration()
    clonedConfiguration.clientToken = 'changed'

    expect(logsPublicApi.getInitConfiguration()).toEqual(
      jasmine.objectContaining({
        clientToken: 'token',
        sampleRate: 80
      })
    )

    logsPublicApi.clearGlobalContext()
    logsPublicApi.clearUser()

    expect(logsPublicApi.getGlobalContext()).toEqual({})
    expect(logsPublicApi.getUser()).toEqual({})
  })
})
