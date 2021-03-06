import {
  toServerDuration,
  relativeToClocks,
  preferredTimeStamp,
  RumEventType,
  LifeCycleEventType
} from '@cloudcare/browser-core'
export function startLongTaskCollection(lifeCycle) {
  lifeCycle.subscribe(
    LifeCycleEventType.PERFORMANCE_ENTRY_COLLECTED,
    function (entry) {
      if (entry.entryType !== 'longtask') {
        return
      }
      var startClocks = relativeToClocks(entry.startTime)
      var rawRumEvent = {
        date: preferredTimeStamp(startClocks),
        long_task: {
          duration: toServerDuration(entry.duration)
        },
        type: RumEventType.LONG_TASK
      }
      lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
        rawRumEvent: rawRumEvent,
        startTime: startClocks.relative
      })
    }
  )
}
