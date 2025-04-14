import {
  toServerDuration,
  relativeToClocks,
  RumEventType,
  LifeCycleEventType,
  UUID,
  RumLongTaskEntryType
} from '@cloudcare/browser-core'
import {
  RumPerformanceEntryType,
  createPerformanceObservable
} from '../../performanceObservable'
export function startLongTaskCollection(lifeCycle, configuration) {
  var performanceLongTaskSubscription = createPerformanceObservable(
    configuration,
    {
      type: RumPerformanceEntryType.LONG_TASK,
      buffered: true
    }
  ).subscribe(function (entries) {
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      if (entry.entryType !== RumPerformanceEntryType.LONG_TASK) {
        break
      }

      var startClocks = relativeToClocks(entry.startTime)
      var rawRumEvent = {
        date: startClocks.timeStamp,
        longTask: {
          id: UUID(),
          entryType: RumLongTaskEntryType.LONG_TASK,
          duration: toServerDuration(entry.duration)
        },
        type: RumEventType.LONG_TASK
      }
      lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
        rawRumEvent: rawRumEvent,
        startTime: startClocks.relative,
        domainContext: { performanceEntry: entry }
      })
    }
  })
  return {
    stop: function () {
      performanceLongTaskSubscription.unsubscribe()
    }
  }
}
