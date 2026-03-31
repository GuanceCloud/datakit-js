import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { startViewContexts } from './viewContexts'

describe('viewContexts', () => {
  it('should add, update and close view contexts through lifecycle events', () => {
    const lifeCycle = new LifeCycle()
    const viewContexts = startViewContexts(lifeCycle)

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      id: 'view-1',
      name: 'Home',
      service: 'web',
      version: '1.0.0',
      context: { step: 1 },
      startClocks: { relative: 10 }
    })

    expect(viewContexts.findView(10)).toEqual({
      id: 'view-1',
      name: 'Home',
      service: 'web',
      version: '1.0.0',
      context: { step: 1 },
      startClocks: { relative: 10 }
    })

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_UPDATED, {
      startClocks: { relative: 11 },
      name: 'Checkout',
      context: { step: 2 }
    })

    expect(viewContexts.findView(11)).toEqual(
      jasmine.objectContaining({
        name: 'Checkout',
        context: { step: 2 }
      })
    )

    lifeCycle.notify(LifeCycleEventType.AFTER_VIEW_ENDED, {
      endClocks: { relative: 12 }
    })

    expect(viewContexts.findView(13)).toBeUndefined()
    viewContexts.stop()
  })

  it('should reset history on session renewal', () => {
    const lifeCycle = new LifeCycle()
    const viewContexts = startViewContexts(lifeCycle)

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      id: 'view-1',
      startClocks: { relative: 10 }
    })
    expect(viewContexts.findView(10)).toEqual(
      jasmine.objectContaining({ id: 'view-1' })
    )

    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)

    expect(viewContexts.findView(10)).toBeUndefined()
    viewContexts.stop()
  })
})
