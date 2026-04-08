import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { HandlerType, StatusType } from '../../logger'
import {
  isAuthorized,
  startLoggerCollection
} from './loggerCollection'

describe('logs/loggerCollection', () => {
  function createLogger(overrides) {
    return Object.assign(
      {
        getContext: () => ({ logger: { name: 'checkout' } }),
        getHandler: () => HandlerType.http,
        getLevel: () => StatusType.debug
      },
      overrides
    )
  }

  it('should authorize logs according to handler and minimum level', () => {
    const logger = createLogger({
      getHandler: () => [HandlerType.console, HandlerType.http],
      getLevel: () => StatusType.warn
    })

    expect(isAuthorized(StatusType.error, HandlerType.http, logger)).toBeTrue()
    expect(isAuthorized(StatusType.info, HandlerType.http, logger)).toBeFalse()
    expect(isAuthorized(StatusType.error, HandlerType.console, logger)).toBeTrue()
    expect(isAuthorized(StatusType.error, HandlerType.silent, logger)).toBeFalse()
  })

  it('should notify raw logs when the http handler is authorized', () => {
    const lifeCycle = new LifeCycle()
    const rawLogs = []

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, (event) => {
      rawLogs.push(event)
    })

    startLoggerCollection(lifeCycle).handleLog(
      {
        message: 'request failed',
        context: { requestId: 'req-1' },
        status: StatusType.error
      },
      createLogger(),
      'stack',
      { context: { account: 'pro' } },
      123456
    )

    expect(rawLogs).toEqual([
      jasmine.objectContaining({
        rawLogsEvent: {
          date: 123456,
          message: 'request failed',
          status: StatusType.error,
          origin: 'logger'
        },
        messageContext: {
          logger: { name: 'checkout' },
          requestId: 'req-1'
        },
        savedCommonContext: { context: { account: 'pro' } },
        domainContext: { handlingStack: 'stack' }
      })
    ])
  })

  it('should skip lifecycle notification when the logger is not authorized for http', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    startLoggerCollection(lifeCycle).handleLog(
      {
        message: 'debug trace',
        context: { step: 1 },
        status: StatusType.debug
      },
      createLogger({
        getHandler: () => HandlerType.console,
        getLevel: () => StatusType.error
      })
    )

    expect(rawLogCollected).not.toHaveBeenCalled()
  })

  it('should emit raw logs without domainContext when no handling stack is provided', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    startLoggerCollection(lifeCycle).handleLog(
      {
        message: 'info trace',
        context: { step: 2 },
        status: StatusType.info
      },
      createLogger()
    )

    expect(rawLogCollected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message: 'info trace',
          status: StatusType.info
        }),
        messageContext: {
          logger: { name: 'checkout' },
          step: 2
        },
        savedCommonContext: undefined
      })
    )
    expect(rawLogCollected.calls.mostRecent().args[0].domainContext).toBeUndefined()
  })
})
