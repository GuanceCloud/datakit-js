import { ErrorSource, LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startReportError } from './reportError'

describe('logs/reportError', () => {
  it('should collect a raw log error event for agent errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    lifeCycle.subscribe(LifeCycleEventType.RAW_LOG_COLLECTED, collected)

    const reportError = startReportError(lifeCycle)

    reportError({
      message: 'worker failure',
      startClocks: {
        timeStamp: 123
      }
    })

    expect(collected).toHaveBeenCalledWith({
      rawLogsEvent: {
        message: 'worker failure',
        date: 123,
        origin: ErrorSource.AGENT,
        status: 'error'
      }
    })
  })
})
