import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startRuntimeErrorCollection } from './runtimeErrorCollection'

describe('logs/runtimeErrorCollection', () => {
  afterEach(() => {
    window.onerror = null
    window.onunhandledrejection = null
  })

  it('should collect unhandled promise rejections as raw error logs', () => {
    const lifeCycle = new LifeCycle()
    const rawLogCollected = jasmine.createSpy('rawLogCollected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, rawLogCollected)

    const collection = startRuntimeErrorCollection(
      {
        forwardErrorsToLogs: true
      },
      lifeCycle
    )
    const error = new Error('promise failed')

    window.onunhandledrejection({ reason: error })

    expect(rawLogCollected.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        rawLogsEvent: jasmine.objectContaining({
          message: 'promise failed',
          origin: 'source',
          status: 'error',
          error: jasmine.objectContaining({
            handling: 'unhandled',
            stack: jasmine.any(String)
          })
        })
      })
    )

    collection.stop()
  })

  it('should become a noop when error forwarding is disabled', () => {
    const collection = startRuntimeErrorCollection(
      {
        forwardErrorsToLogs: false
      },
      new LifeCycle()
    )

    expect(() => collection.stop()).not.toThrow()
  })
})
