import {
  LifeCycle,
  LifeCycleEventType,
  RumEventType
} from '@cloudcare/browser-core'
import { trackEventCounts } from './trackEventCounts'

describe('trackEventCounts', () => {
  it('should increment counters for child rum events', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackEventCounts({
      lifeCycle,
      isChildEvent: () => true,
      onChange
    })

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.LONG_TASK
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.RESOURCE
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
      action: {
        frustration: {
          type: ['rage_click', 'dead_click']
        }
      }
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 1,
      longTaskCount: 1,
      resourceCount: 1,
      actionCount: 1,
      frustrationCount: 2
    })
    expect(onChange).toHaveBeenCalledTimes(4)
  })

  it('should ignore view and non-child events', () => {
    const lifeCycle = new LifeCycle()
    const tracker = trackEventCounts({
      lifeCycle,
      isChildEvent: (event) => event.allowChild === true
    })

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.VIEW,
      allowChild: true
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      allowChild: false
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 0,
      frustrationCount: 0
    })
  })

  it('should unsubscribe when stopped', () => {
    const lifeCycle = new LifeCycle()
    const tracker = trackEventCounts({
      lifeCycle,
      isChildEvent: () => true
    })

    tracker.stop()
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR
    })

    expect(tracker.eventCounts.errorCount).toBe(0)
  })

  it('should count actions without frustration and work without an onChange callback', () => {
    const lifeCycle = new LifeCycle()
    const tracker = trackEventCounts({
      lifeCycle,
      isChildEvent: () => true
    })

    expect(() => {
      lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
        type: RumEventType.ACTION,
        action: {}
      })
    }).not.toThrow()

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 1,
      frustrationCount: 0
    })
  })

  it('should handle actions with an empty frustration list', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackEventCounts({
      lifeCycle,
      isChildEvent: () => true,
      onChange
    })

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ACTION,
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
  })

  it('should ignore unsupported rum event types without triggering onChange', () => {
    const lifeCycle = new LifeCycle()
    const onChange = jasmine.createSpy('onChange')
    const tracker = trackEventCounts({
      lifeCycle,
      isChildEvent: () => true,
      onChange
    })

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: 'custom-event'
    })

    expect(tracker.eventCounts).toEqual({
      errorCount: 0,
      longTaskCount: 0,
      resourceCount: 0,
      actionCount: 0,
      frustrationCount: 0
    })
    expect(onChange).not.toHaveBeenCalled()
  })
})
