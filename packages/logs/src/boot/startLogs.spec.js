import { HandlerType, StatusType } from '../domain/logger'
import { startLogs } from './startLogs'

describe('logs/startLogs', () => {
  let originalBridge
  let originalRumGlobal

  beforeEach(() => {
    originalBridge = window.FTWebViewJavascriptBridge
    originalRumGlobal = window.DATAFLUX_RUM
  })

  afterEach(() => {
    window.FTWebViewJavascriptBridge = originalBridge
    window.DATAFLUX_RUM = originalRumGlobal
  })

  it('should forward logger events through the bridge path and expose internal context', () => {
    const sendEvent = jasmine.createSpy('sendEvent')

    window.FTWebViewJavascriptBridge = {
      sendEvent
    }
    window.DATAFLUX_RUM = {
      getInternalContext: jasmine.createSpy('getInternalContext').and.returnValue({
        application: { id: 'app-1' },
        userAction: { id: 'action-1' },
        view: { id: 'view-1' }
      })
    }

    const logs = startLogs(
      {
        clientToken: 'token'
      },
      {
        sdkName: 'logs-sdk',
        sdkVersion: '1.2.3',
        service: 'browser',
        env: 'prod',
        version: '9.9.9',
        sessionSampleRate: 100,
        eventRateLimiterThreshold: 100,
        forwardConsoleLogs: [],
        forwardReports: [],
        forwardErrorsToLogs: false
      },
      () => ({
        context: { account: 'pro' },
        user: { id: 'user-1' },
        view: {
          url: 'https://example.com/checkout',
          referrer: 'https://example.com/'
        }
      })
    )

    logs.handleLog(
      {
        message: 'manual log',
        context: { requestId: 'req-1' },
        status: StatusType.info
      },
      {
        getContext: () => ({ logger: { name: 'checkout' } }),
        getHandler: () => HandlerType.http,
        getLevel: () => StatusType.debug
      },
      'stack',
      {
        context: { account: 'pro' },
        user: { id: 'user-1' },
        view: {
          url: 'https://example.com/checkout',
          referrer: 'https://example.com/'
        }
      },
      123456
    )

    const payload = JSON.parse(sendEvent.calls.mostRecent().args[0])
    expect(payload.name).toBe('log')
    expect(payload.data).toEqual(
      jasmine.objectContaining({
        message: 'manual log',
        service: 'browser',
        env: 'prod',
        version: '9.9.9',
        origin: 'logger',
        status: 'info',
        account: 'pro',
        requestId: 'req-1',
        application: { id: 'app-1' },
        user_action: { id: 'action-1' },
        view: jasmine.objectContaining({
          id: 'view-1',
          url: 'https://example.com/checkout'
        })
      })
    )

    expect(logs.getInternalContext()).toEqual({
      session: {
        id: undefined
      }
    })

    logs.stop()
  })

  it('should start and stop safely on the batch path without rum context', () => {
    window.FTWebViewJavascriptBridge = undefined
    window.DATAFLUX_RUM = undefined

    const logs = startLogs(
      {
        clientToken: 'token',
        sampleRate: 100
      },
      {
        sdkName: 'logs-sdk',
        sdkVersion: '1.2.3',
        service: 'browser',
        env: 'prod',
        version: '9.9.9',
        sessionSampleRate: 100,
        eventRateLimiterThreshold: 100,
        forwardConsoleLogs: [],
        forwardReports: [],
        forwardErrorsToLogs: false,
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 50,
        flushTimeout: 30000,
        messageBytesLimit: 256,
        rumEndpoint: 'https://rum.example.com/v1/input',
        logsEndpoint: 'https://logs.example.com/v1/input'
      },
      () => ({
        context: { account: 'pro' },
        user: { id: 'user-1' },
        view: {
          url: 'https://example.com/checkout',
          referrer: 'https://example.com/'
        }
      })
    )

    expect(logs.getInternalContext()).toEqual({
      session: {
        id: undefined
      }
    })

    expect(() => logs.stop()).not.toThrow()
  })
})
