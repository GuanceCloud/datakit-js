import {
  ActionType,
  LifeCycle,
  LifeCycleEventType,
  Observable
} from '@cloudcare/browser-core'
import { startRumEventCollection } from './rum'

describe('rum', () => {
  it('should wire view and url contexts and expose manual action collection', () => {
    const lifeCycle = new LifeCycle()
    const locationChangeObservable = new Observable()
    const rawRumEvents = []
    const pageStateHistory = {
      stop: jasmine.createSpy('stop'),
      wasInPageStateAt: jasmine.createSpy('wasInPageStateAt').and.returnValue(true)
    }

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, (event) => {
      rawRumEvents.push(event)
    })

    const rumEventCollection = startRumEventCollection(
      lifeCycle,
      {
        trackUserInteractions: false
      },
      {
        href: 'https://example.com/products?sku=1',
        host: 'example.com',
        pathname: '/products',
        hash: ''
      },
      {
        findTrackedSession: () => undefined
      },
      {},
      pageStateHistory,
      locationChangeObservable,
      new Observable(),
      () => ({ context: { plan: 'pro' } }),
      jasmine.createSpy('reportError')
    )

    lifeCycle.notify(LifeCycleEventType.BEFORE_VIEW_CREATED, {
      id: 'view-1',
      name: 'Products',
      startClocks: {
        relative: 10,
        timeStamp: 20
      }
    })

    expect(rumEventCollection.viewContexts.findView(10)).toEqual(
      jasmine.objectContaining({
        id: 'view-1',
        name: 'Products'
      })
    )
    expect(rumEventCollection.urlContexts.findUrl(10)).toEqual(
      jasmine.objectContaining({
        url: 'https://example.com/products?sku=1',
        host: 'example.com',
        path: '/products',
        pathname: '/products'
      })
    )
    expect(rumEventCollection.actionContexts.findActionId()).toBeUndefined()
    expect(rumEventCollection.actionContexts.findAllActionId()).toBeUndefined()

    rumEventCollection.addAction(
      {
        name: 'Add to cart',
        type: ActionType.CUSTOM,
        context: { sku: '1' },
        startClocks: {
          relative: 15,
          timeStamp: 25
        }
      },
      { view: { id: 'saved-view' } }
    )

    expect(rawRumEvents[0]).toEqual(
      jasmine.objectContaining({
        savedCommonContext: { view: { id: 'saved-view' } },
        customerContext: { sku: '1' },
        startTime: 15,
        rawRumEvent: jasmine.objectContaining({
          type: 'action',
          action: jasmine.objectContaining({
            type: ActionType.CUSTOM,
            target: {
              name: 'Add to cart'
            }
          })
        })
      })
    )

    locationChangeObservable.notify({
      newLocation: {
        href: 'https://example.com/orders#/checkout',
        host: 'example.com',
        pathname: '/orders',
        hash: '#/checkout'
      }
    })

    expect(rumEventCollection.urlContexts.findUrl()).toEqual(
      jasmine.objectContaining({
        url: 'https://example.com/orders#/checkout',
        path: '/#/checkout',
        pathname: '/orders'
      })
    )

    rumEventCollection.stop()

    expect(pageStateHistory.stop).toHaveBeenCalled()
  })
})
