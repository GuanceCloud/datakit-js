import {
  ErrorSource,
  LifeCycleEventType,
  addTelemetryDebug
} from '@cloudcare/browser-core'
import { StatusType } from './logger'
export function startReportError(lifeCycle) {
  return function (error) {
    lifeCycle.notify(LifeCycleEventType.RAW_LOG_COLLECTED, {
      rawLogsEvent: {
        message: error.message,
        date: error.startClocks.timeStamp,
        origin: ErrorSource.AGENT,
        status: StatusType.error
      }
    })
    addTelemetryDebug('Error reported to customer', {
      'error.message': error.message
    })
  }
}
