import {
  LifeCycle,
  LifeCycleEventType,
  ErrorSource,
  ErrorHandling,
  NonErrorPrefix,
  computeRawError
} from '@cloudcare/browser-core'
import { doStartErrorCollection, startErrorCollection } from './errorCollection'
import { PageState } from '../../contexts/pageStateHistory'

describe('errorCollection', () => {
  it('should transform raw errors into raw rum events', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const startClocks = {
      relative: 123,
      timeStamp: 456
    }

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: (state, startTime) =>
        state === PageState.ACTIVE && startTime === 123
    })

    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
      customerContext: { feature: 'checkout' },
      savedCommonContext: { view: { id: 'view-1' } },
      error: computeRawError({
        stackTrace: undefined,
        originalError: new Error('boom'),
        handlingStack: 'stack',
        startClocks,
        nonErrorPrefix: NonErrorPrefix.UNCAUGHT,
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED
      })
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.customerContext).toEqual({ feature: 'checkout' })
    expect(event.savedCommonContext).toEqual({ view: { id: 'view-1' } })
    expect(event.startTime).toBe(123)
    expect(event.rawRumEvent.type).toBe('error')
    expect(event.rawRumEvent.error.message).toContain('boom')
    expect(event.rawRumEvent.view.in_foreground).toBeTrue()
    expect(event.domainContext.error).toEqual(jasmine.any(Error))
  })

  it('should add custom handled errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => false
    })

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addError(
      {
        error: 'custom failure',
        handlingStack: 'provided-stack',
        startClocks: {
          relative: 10,
          timeStamp: 20
        },
        context: { from: 'spec' }
      },
      { service: 'rum' }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.customerContext).toEqual({ from: 'spec' })
    expect(event.savedCommonContext).toEqual({ service: 'rum' })
    expect(event.rawRumEvent.error.handling).toBe('handled')
    expect(event.rawRumEvent.error.source).toBe('custom')
    expect(event.rawRumEvent.error.message).toContain('custom failure')
  })

  it('should mark an error session only once until the session is renewed', () => {
    const lifeCycle = new LifeCycle()
    const setErrorForSession = jasmine.createSpy('setErrorForSession')
    const collected = jasmine.createSpy('collected')

    startErrorCollection(
      lifeCycle,
      {},
      {
        findTrackedSession: () => ({
          isErrorSession: true,
          sessionHasError: false
        }),
        setErrorForSession
      },
      {
        wasInPageStateAt: () => true
      }
    )
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    console.error(new Error('first session error'))
    console.error(new Error('second session error'))

    expect(setErrorForSession).toHaveBeenCalledTimes(1)
    expect(collected).toHaveBeenCalled()

    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)
    console.error(new Error('renewed session error'))

    expect(setErrorForSession).toHaveBeenCalledTimes(2)
  })

  it('should not remark sessions that already have an error', () => {
    const lifeCycle = new LifeCycle()
    const setErrorForSession = jasmine.createSpy('setErrorForSession')

    startErrorCollection(
      lifeCycle,
      {},
      {
        findTrackedSession: () => ({
          isErrorSession: true,
          sessionHasError: true
        }),
        setErrorForSession
      },
      {
        wasInPageStateAt: () => false
      }
    )

    console.error(new Error('already marked error session'))

    expect(setErrorForSession).not.toHaveBeenCalled()
  })
})
