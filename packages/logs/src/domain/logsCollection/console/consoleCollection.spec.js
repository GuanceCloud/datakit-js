import {
  ConsoleApiName,
  LifeCycle,
  LifeCycleEventType,
  resetConsoleObservable
} from '@cloudcare/browser-core'
import { startConsoleCollection } from './consoleCollection'

describe('logs/consoleCollection', () => {
  afterEach(() => {
    resetConsoleObservable()
  })

  it('should collect forwarded console logs into raw log lifecycle events', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    const collection = startConsoleCollection(
      {
        forwardConsoleLogs: [ConsoleApiName.warn]
      },
      lifeCycle
    )

    console.warn('warning', { code: 1 })

    expect(rawLogCollected).toHaveBeenCalledWith(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message: 'warning {\n  "code": 1\n}',
          origin: 'console',
          status: 'warn'
        }),
        domainContext: {
          handlingStack: jasmine.any(String)
        }
      })
    )

    collection.stop()
  })

  it('should include serialized raw error details for console.error events', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    const collection = startConsoleCollection(
      {
        forwardConsoleLogs: [ConsoleApiName.error]
      },
      lifeCycle
    )

    console.error(new Error('boom'), 'context')

    expect(rawLogCollected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message: 'Error: boom context',
          origin: 'console',
          status: 'error',
          error: jasmine.objectContaining({
            handling: 'handled',
            stack: jasmine.any(String)
          })
        })
      })
    )

    collection.stop()
  })
})
