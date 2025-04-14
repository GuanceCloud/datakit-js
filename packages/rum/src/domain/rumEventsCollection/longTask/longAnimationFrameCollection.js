import {
  toServerDuration,
  relativeToClocks,
  UUID,
  LifeCycleEventType,
  RumLongTaskEntryType,
  RumEventType
} from '@cloudcare/browser-core'
import {
  createPerformanceObservable,
  RumPerformanceEntryType
} from '../../performanceObservable'

export function startLongAnimationFrameCollection(lifeCycle, configuration) {
  const performanceResourceSubscription = createPerformanceObservable(
    configuration,
    {
      type: RumPerformanceEntryType.LONG_ANIMATION_FRAME,
      buffered: true
    }
  ).subscribe((entries) => {
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
      var entry = entries_1[_i]
      const startClocks = relativeToClocks(entry.startTime)
      const rawRumEvent = {
        date: startClocks.timeStamp,
        longTask: {
          id: UUID(),
          entryType: RumLongTaskEntryType.LONG_ANIMATION_FRAME,
          duration: toServerDuration(entry.duration),
          blockingDuration: toServerDuration(entry.blockingDuration),
          firstUiEventTimestamp: toServerDuration(entry.firstUIEventTimestamp),
          renderStart: toServerDuration(entry.renderStart),
          styleAndLayoutStart: toServerDuration(entry.styleAndLayoutStart),
          startTime: toServerDuration(entry.startTime),
          scripts: entry.scripts.map(function (script) {
            return {
              duration: toServerDuration(script.duration),
              pause_duration: toServerDuration(script.pauseDuration),
              forced_style_and_layout_duration: toServerDuration(
                script.forcedStyleAndLayoutDuration
              ),
              start_time: toServerDuration(script.startTime),
              execution_start: toServerDuration(script.executionStart),
              source_url: script.sourceURL,
              source_function_name: script.sourceFunctionName,
              source_char_position: script.sourceCharPosition,
              invoker: script.invoker,
              invoker_type: script.invokerType,
              window_attribution: script.windowAttribution
            }
          })
        },
        type: RumEventType.LONG_TASK
      }

      lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, {
        rawRumEvent,
        startTime: startClocks.relative,
        domainContext: { performanceEntry: entry }
      })
    }
  })

  return {
    stop: function () {
      performanceResourceSubscription.unsubscribe()
    }
  }
}
