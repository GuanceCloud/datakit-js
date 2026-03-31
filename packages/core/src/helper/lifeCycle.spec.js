import { LifeCycle, LifeCycleEventType } from './lifeCycle'

describe('lifeCycle', () => {
  it('should expose lifecycle event type constants', () => {
    expect(LifeCycleEventType.VIEW_CREATED).toBe('VIEW_CREATED')
    expect(LifeCycleEventType.REQUEST_COMPLETED).toBe('REQUEST_COMPLETED')
    expect(LifeCycleEventType.LOG_COLLECTED).toBe('LOG_COLLECTED')
  })

  it('should notify all subscribers of an event', () => {
    const lifeCycle = new LifeCycle()
    const first = jasmine.createSpy('first')
    const second = jasmine.createSpy('second')

    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, first)
    lifeCycle.subscribe(LifeCycleEventType.VIEW_CREATED, second)

    lifeCycle.notify(LifeCycleEventType.VIEW_CREATED, { id: 'view-1' })

    expect(first).toHaveBeenCalledWith({ id: 'view-1' })
    expect(second).toHaveBeenCalledWith({ id: 'view-1' })
  })

  it('should unsubscribe only the matching callback', () => {
    const lifeCycle = new LifeCycle()
    const first = jasmine.createSpy('first')
    const second = jasmine.createSpy('second')

    const firstSubscription = lifeCycle.subscribe(
      LifeCycleEventType.RAW_RUM_EVENT_COLLECTED,
      first
    )
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, second)

    firstSubscription.unsubscribe()
    lifeCycle.notify(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, { type: 'view' })

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith({ type: 'view' })
  })

  it('should ignore notifications for events without subscribers', () => {
    const lifeCycle = new LifeCycle()

    expect(() => {
      lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED, { id: 'session-1' })
    }).not.toThrow()
  })
})
