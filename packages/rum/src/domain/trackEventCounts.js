import { noop, RumEventType, LifeCycleEventType } from '@cloudcare/browser-core'

export function trackEventCounts(data) {
  var lifeCycle = data.lifeCycle
  var isChildEvent = data.isChildEvent
  var callback = data.onChange
  if (callback === undefined) {
    callback = noop
  }
  var eventCounts = {
    errorCount: 0,
    longTaskCount: 0,
    resourceCount: 0,
    actionCount: 0,
    frustrationCount: 0
  }

  var subscription = lifeCycle.subscribe(
    LifeCycleEventType.RUM_EVENT_COLLECTED,
    function (event) {
      if (event.type === RumEventType.VIEW || !isChildEvent(event)) {
        return
      }
      switch (event.type) {
        case RumEventType.ERROR:
          eventCounts.errorCount += 1

          callback()
          break
        case RumEventType.ACTION:
          if (event.action.frustration) {
            eventCounts.frustrationCount += event.action.frustration.type.length
          }
          eventCounts.actionCount += 1
          callback()
          break
        case RumEventType.LONG_TASK:
          eventCounts.longTaskCount += 1
          callback()
          break
        case RumEventType.RESOURCE:
          eventCounts.resourceCount += 1
          callback()
          break
      }
    }
  )

  return {
    stop: function () {
      subscription.unsubscribe()
    },
    eventCounts: eventCounts
  }
}
