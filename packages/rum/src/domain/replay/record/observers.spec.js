import {
  ActionType,
  LifeCycleEventType,
  RumEventType
} from '@cloudcare/browser-core'
import { RecordType } from '../../../types'
import {
  getRecordIdForEvent,
  initFrustrationObserver
} from './observers'

describe('replay/record/observers', () => {
  it('should allocate stable record ids per event object', () => {
    const eventA = {}
    const eventB = {}

    const firstId = getRecordIdForEvent(eventA)
    const secondId = getRecordIdForEvent(eventA)
    const thirdId = getRecordIdForEvent(eventB)

    expect(firstId).toBe(secondId)
    expect(thirdId).toBeGreaterThan(firstId)
  })

  it('should emit frustration records for click actions with frustration metadata', () => {
    let handler
    const lifeCycle = {
      subscribe(eventType, callback) {
        expect(eventType).toBe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED)
        handler = callback
        return {
          unsubscribe: jasmine.createSpy('unsubscribe')
        }
      }
    }
    const frustrationCb = jasmine.createSpy('frustrationCb')
    const event1 = {}
    const event2 = {}
    const stop = initFrustrationObserver(lifeCycle, frustrationCb, {})

    handler({
      rawRumEvent: {
        date: 1234,
        type: RumEventType.ACTION,
        action: {
          type: ActionType.CLICK,
          frustration: {
            type: ['rage_click']
          }
        }
      },
      domainContext: {
        events: [event1, event2]
      }
    })

    expect(frustrationCb).toHaveBeenCalledWith({
      timestamp: 1234,
      type: RecordType.FrustrationRecord,
      data: {
        frustrationTypes: ['rage_click'],
        recordIds: [getRecordIdForEvent(event1), getRecordIdForEvent(event2)]
      }
    })
    expect(stop).toEqual(jasmine.any(Function))
  })

  it('should ignore non-frustration or non-click events', () => {
    let handler
    const lifeCycle = {
      subscribe(eventType, callback) {
        handler = callback
        return {
          unsubscribe: jasmine.createSpy('unsubscribe')
        }
      }
    }
    const frustrationCb = jasmine.createSpy('frustrationCb')

    initFrustrationObserver(lifeCycle, frustrationCb, {})

    handler({
      rawRumEvent: {
        date: 10,
        type: RumEventType.VIEW,
        action: {
          type: ActionType.CLICK
        }
      },
      domainContext: {
        events: [{}]
      }
    })
    handler({
      rawRumEvent: {
        date: 10,
        type: RumEventType.ACTION,
        action: {
          type: ActionType.CLICK,
          frustration: {
            type: []
          }
        }
      },
      domainContext: {
        events: [{}]
      }
    })

    expect(frustrationCb).not.toHaveBeenCalled()
  })
})
