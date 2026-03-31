import {
  LifeCycle,
  LifeCycleEventType,
  RumEventType
} from '@cloudcare/browser-core'
import { trackViewEventCounts } from './trackViewEventCounts'

describe('trackViewEventCounts', () => {
  it('should count only events belonging to the tracked view', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      view: { id: 'view-1' }
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.RESOURCE,
      view: { id: 'view-2' }
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.LONG_TASK,
      view: { id: 'view-1' }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 1,
      longTaskCount: 1,
      resourceCount: 0,
      actionCount: 0,
      frustrationCount: 0
    })
    expect(onChange).toHaveBeenCalledTimes(2)

    tracker.stop()
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      view: { id: 'view-1' }
    })
    expect(tracker.eventCounts.errorCount).toBe(1)
  })
})
