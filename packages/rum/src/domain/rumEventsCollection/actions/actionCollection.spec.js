import {
  ActionType,
  LifeCycle,
  LifeCycleEventType
} from '@cloudcare/browser-core'
import { startActionCollection } from './actionCollection'
import { PageState } from '../../contexts/pageStateHistory'

describe('actionCollection', () => {
  it('should collect auto actions emitted by the life cycle', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startActionCollection(
      lifeCycle,
      {},
      {
        trackUserInteractions: false
      },
      {
        wasInPageStateAt: (state, relative) =>
          state === PageState.ACTIVE && relative === 10
      }
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    lifeCycle.notify(LifeCycleEventType.AUTO_ACTION_COMPLETED, {
      id: 'click-id',
      type: ActionType.CLICK,
      name: 'Checkout',
      duration: 123,
      counts: {
        errorCount: 1,
        longTaskCount: 2,
        resourceCount: 3
      },
      frustrationTypes: ['rage_click'],
      target: {
        selector: 'button.checkout'
      },
      position: {
        x: 4,
        y: 8
      },
      event: { type: 'click' },
      events: [{ type: 'click' }],
      startClocks: {
        relative: 10,
        timeStamp: 20
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(collection.actionContexts.findActionId()).toBeUndefined()
    expect(event.rawRumEvent.type).toBe('action')
    expect(event.rawRumEvent.action.type).toBe(ActionType.CLICK)
    expect(event.rawRumEvent.action.target.name).toBe('Checkout')
    expect(event.rawRumEvent.view.in_foreground).toBeTrue()
    expect(event.rawRumEvent._gc.action.target.selector).toBe('button.checkout')
    expect(event.domainContext.event).toEqual({ type: 'click' })
  })

  it('should add custom actions with saved common context', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = startActionCollection(
      lifeCycle,
      {},
      {
        trackUserInteractions: false
      },
      {
        wasInPageStateAt: () => false
      }
    )

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addAction(
      {
        type: 'custom',
        name: 'Open Panel',
        context: {
          duration: 42,
          from: 'spec'
        },
        startClocks: {
          relative: 5,
          timeStamp: 15
        }
      },
      { view: { id: 'view-1' } }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.savedCommonContext).toEqual({ view: { id: 'view-1' } })
    expect(event.customerContext).toEqual({
      duration: 42,
      from: 'spec'
    })
    expect(event.rawRumEvent.action.loadingTime).toBe(42)
    expect(event.domainContext).toEqual({})
  })
})
