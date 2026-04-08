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

  it('should aggregate action and frustration counts for the tracked view only', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
      view: { id: 'view-1' },
      action: {
        frustration: {
          type: ['rage_click', 'dead_click']
        }
      }
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
      view: { id: 'view-2' },
      action: {
        frustration: {
          type: ['rage_click']
        }
      }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 1,
      frustrationCount: 2
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    tracker.stop()
  })

  it('should count tracked actions with an empty frustration list without incrementing frustrationCount', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
      view: { id: 'view-1' },
      action: {
        frustration: {
          type: []
        }
      }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 1,
      frustrationCount: 0
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    tracker.stop()
  })

  it('should ignore actions from other views without triggering onChange', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
      view: { id: 'view-2' },
      action: {
        frustration: {
          type: ['rage_click']
        }
      }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 0,
      frustrationCount: 0
    })
    expect(onChange).not.toHaveBeenCalled()

    tracker.stop()
  })

  it('should ignore view events even when they belong to the tracked view', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.VIEW,
      view: { id: 'view-1' }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 0,
      frustrationCount: 0
    })
    expect(onChange).not.toHaveBeenCalled()

    tracker.stop()
  })

  it('should count tracked actions without frustration metadata', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
      view: { id: 'view-1' },
      action: {}
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 1,
      frustrationCount: 0
    })
    expect(onChange).toHaveBeenCalledTimes(1)

    tracker.stop()
  })

  it('should count tracked resource events and trigger onChange once per event', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackViewEventCounts(lifeCycle, 'view-1', onChange)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.RESOURCE,
      view: { id: 'view-1' }
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.RESOURCE,
      view: { id: 'view-1' }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 2,
      actionCount: 0,
      frustrationCount: 0
    })
    expect(onChange).toHaveBeenCalledTimes(2)

    tracker.stop()
  })
})
