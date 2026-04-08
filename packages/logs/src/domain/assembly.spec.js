import {
  ErrorSource,
  LifeCycle,
  LifeCycleEventType
} from '@cloudcare/browser-core'
import { getRUMInternalContext, startLogsAssembly } from './assembly'

describe('logs/assembly', () => {
  let originalRumGlobal

  beforeEach(() => {
    originalRumGlobal = window.DATAFLUX_RUM
  })

  afterEach(() => {
    window.DATAFLUX_RUM = originalRumGlobal
  })

  function startAssembly(lifeCycle, beforeSend, reportError) {
    startLogsAssembly(
      {
        findTrackedSession: jasmine
          .createSpy('findTrackedSession')
          .and.returnValue({ id: 'session-1' })
      },
      {
        sdkName: 'logs-sdk',
        sdkVersion: '1.2.3',
        service: 'browser',
        env: 'prod',
        version: '9.9.9',
        eventRateLimiterThreshold: 100,
        beforeSend
      },
      lifeCycle,
      () => ({
        context: { account: 'pro' },
        user: { id: 'user-1' },
        view: {
          referrer: 'https://example.com/login',
          url: 'https://example.com/checkout'
        }
      }),
      reportError || jasmine.createSpy('reportError')
    )
  }

  it('should assemble raw logs with common context and rum internal context', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    window.DATAFLUX_RUM = {
      getInternalContext: jasmine.createSpy('getInternalContext').and.returnValue({
        view: { id: 'view-1' },
        userAction: { id: 'action-1' },
        application: { id: 'app-1' }
      })
    }
    startAssembly(lifeCycle)
    lifeCycle.subscribe(LifeCycleEventType.LOG_COLLECTED, collected)

    lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, {
      rawLogsEvent: {
        date: 123456,
        message: 'request failed',
        status: 'error',
        origin: ErrorSource.LOGGER
      },
      messageContext: {
        requestId: 'req-1'
      },
      domainContext: {
        handlingStack: 'stack'
      }
    })

    expect(collected).toHaveBeenCalledWith(
      jasmine.objectContaining({
        message: 'request failed',
        status: 'error',
        service: 'browser',
        env: 'prod',
        version: '9.9.9',
        type: 'logger',
        session: { id: 'session-1' },
        view: jasmine.objectContaining({
          id: 'view-1',
          referrer: 'https://example.com/login',
          url: 'https://example.com/checkout'
        }),
        user_action: { id: 'action-1' },
        application: { id: 'app-1' },
        user: { id: 'user-1' },
        account: 'pro',
        requestId: 'req-1',
        _gc: {
          sdk_name: 'logs-sdk',
          sdk_version: '1.2.3'
        }
      })
    )
  })

  it('should let beforeSend mutate the payload and drop rejected logs', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    startAssembly(lifeCycle, (event, domainContext) => {
      if (event.origin === ErrorSource.LOGGER) {
        expect(domainContext).toEqual({ requestId: 'req-2' })
      }
      event.message = 'masked'
      return event.origin === ErrorSource.AGENT
    })
    lifeCycle.subscribe(LifeCycleEventType.LOG_COLLECTED, collected)

    lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, {
      rawLogsEvent: {
        date: 123456,
        message: 'drop me',
        status: 'info',
        origin: ErrorSource.LOGGER
      },
      domainContext: {
        requestId: 'req-2'
      }
    })

    expect(collected).not.toHaveBeenCalled()

    lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, {
      rawLogsEvent: {
        date: 123457,
        message: 'keep me',
        status: 'info',
        origin: ErrorSource.AGENT
      }
    })

    expect(collected.calls.mostRecent().args[0].message).toBe('masked')
  })

  it('should expose rum internal context only when the rum global provides it', () => {
    expect(getRUMInternalContext(10)).toBeUndefined()

    window.DATAFLUX_RUM = {
      getInternalContext: jasmine
        .createSpy('getInternalContext')
        .and.returnValue({ view: { id: 'view-2' } })
    }

    expect(getRUMInternalContext(10)).toEqual({ view: { id: 'view-2' } })
  })
})
