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

  it('should preserve raw error type and causes when forwarding collected errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const startClocks = {
      relative: 5,
      timeStamp: 6
    }
    const causes = [{ type: 'cause', message: 'root' }]

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => true
    })

    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
      error: {
        startClocks,
        message: 'typed error',
        type: 'NetworkError',
        causes,
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED,
        handlingStack: 'stack',
        stack: 'stack',
        originalError: 'typed error'
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.error.type).toBe('NetworkError')
    expect(event.rawRumEvent.error.causes).toEqual(causes)
  })

  it('should mark raw collected errors as background when page state is inactive', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => false
    })

    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
      error: {
        startClocks: {
          relative: 3,
          timeStamp: 4
        },
        message: 'background raw error',
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED,
        handlingStack: 'bg-stack',
        stack: 'stack',
        originalError: new Error('background raw error')
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.view.in_foreground).toBeFalse()
  })

  it('should preserve raw error source and handling when forwarding collected errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => false
    })

    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
      error: {
        startClocks: {
          relative: 9,
          timeStamp: 10
        },
        message: 'forwarded error',
        source: ErrorSource.CONSOLE,
        handling: ErrorHandling.HANDLED,
        handlingStack: 'console-stack',
        stack: 'stack',
        originalError: new Error('forwarded error')
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.error.source).toBe('console')
    expect(event.rawRumEvent.error.handling).toBe('handled')
    expect(event.rawRumEvent.view.in_foreground).toBeFalse()
  })

  it('should keep domainContext.error undefined when the raw error has no originalError', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => true
    })

    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
      error: {
        startClocks: {
          relative: 11,
          timeStamp: 12
        },
        message: 'missing original',
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED,
        handlingStack: 'missing-stack',
        stack: 'stack'
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.domainContext.error).toBeUndefined()
    expect(event.rawRumEvent.error.message).toBe('missing original')
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

  it('should mark a session sampled for error replay when an error is collected', () => {
    const lifeCycle = new LifeCycle()
    const setErrorForSession = jasmine.createSpy('setErrorForSession')
    const collected = jasmine.createSpy('collected')

    startErrorCollection(
      lifeCycle,
      {},
      {
        findTrackedSession: () => ({
          isErrorSession: false,
          errorSessionReplayAllowed: true,
          sessionHasError: false
        }),
        setErrorForSession
      },
      {
        wasInPageStateAt: () => true
      }
    )
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    console.error(new Error('error replay session error'))

    expect(setErrorForSession).toHaveBeenCalledTimes(1)
    expect(collected).toHaveBeenCalled()
  })

  it('should mark a session sampled for error replay when a custom error is added', () => {
    const lifeCycle = new LifeCycle()
    const setErrorForSession = jasmine.createSpy('setErrorForSession')
    const collected = jasmine.createSpy('collected')

    const collection = startErrorCollection(
      lifeCycle,
      {},
      {
        findTrackedSession: () => ({
          isErrorSession: false,
          errorSessionReplayAllowed: true,
          sessionHasError: false
        }),
        setErrorForSession
      },
      {
        wasInPageStateAt: () => true
      }
    )
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    collection.addError({
      error: new Error('custom error replay session error'),
      handlingStack: 'provided-stack',
      startClocks: {
        relative: 10,
        timeStamp: 20
      }
    })

    expect(setErrorForSession).toHaveBeenCalledTimes(1)
    expect(collected).toHaveBeenCalled()
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

  it('should forward errors without marking sessions that are not error sessions', () => {
    const lifeCycle = new LifeCycle()
    const setErrorForSession = jasmine.createSpy('setErrorForSession')
    const collected = jasmine.createSpy('collected')

    startErrorCollection(
      lifeCycle,
      {},
      {
        findTrackedSession: () => ({
          isErrorSession: false,
          sessionHasError: false
        }),
        setErrorForSession
      },
      {
        wasInPageStateAt: () => true
      }
    )
    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)

    console.error(new Error('non error session'))

    expect(setErrorForSession).not.toHaveBeenCalled()
    expect(collected).toHaveBeenCalled()
    expect(collected.calls.mostRecent().args[0].rawRumEvent.error.source).toBe(
      'console'
    )
  })

  it('should preserve provided Error objects and mark inactive page state on custom errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => false
    })
    const error = new Error('provided boom')

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addError(
      {
        error,
        handlingStack: 'provided-stack',
        startClocks: {
          relative: 30,
          timeStamp: 40
        }
      },
      { service: 'rum' }
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.rawRumEvent.view.in_foreground).toBeFalse()
    expect(event.rawRumEvent.error.message).toContain('provided boom')
    expect(event.domainContext.error).toBe(error)
  })

  it('should serialize handling stack and browser source type for custom errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => true
    })

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addError(
      {
        error: 'serializable failure',
        handlingStack: 'custom-stack',
        startClocks: {
          relative: 99,
          timeStamp: 199
        }
      },
      undefined
    )

    const event = collected.calls.mostRecent().args[0]
    expect(event.startTime).toBe(99)
    expect(event.rawRumEvent.error.handling_stack).toBe('custom-stack')
    expect(event.rawRumEvent.error.source_type).toBe('browser')
    expect(event.rawRumEvent.error.source).toBe('custom')
  })

  it('should not attach context fields for custom errors when none are provided', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const collection = doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => true
    })

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    collection.addError({
      error: 'contextless failure',
      handlingStack: 'stackless',
      startClocks: {
        relative: 12,
        timeStamp: 34
      }
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.customerContext).toBeUndefined()
    expect(event.savedCommonContext).toBeUndefined()
    expect(event.rawRumEvent.error.message).toContain('contextless failure')
  })

  it('should keep missing saved common context undefined for raw collected errors', () => {
    const lifeCycle = new LifeCycle()
    const collected = jasmine.createSpy('collected')
    const startClocks = {
      relative: 15,
      timeStamp: 25
    }

    lifeCycle.subscribe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED, collected)
    doStartErrorCollection(lifeCycle, {
      wasInPageStateAt: () => true
    })

    lifeCycle.notify(LifeCycleEventType.RAW_ERROR_COLLECTED, {
      error: computeRawError({
        stackTrace: undefined,
        originalError: 'plain error',
        handlingStack: 'raw-stack',
        startClocks,
        nonErrorPrefix: NonErrorPrefix.UNCAUGHT,
        source: ErrorSource.SOURCE,
        handling: ErrorHandling.UNHANDLED
      })
    })

    const event = collected.calls.mostRecent().args[0]
    expect(event.customerContext).toBeUndefined()
    expect(event.savedCommonContext).toBeUndefined()
    expect(event.rawRumEvent.error.handling_stack).toBe('raw-stack')
    expect(event.domainContext.error).toBe('plain error')
  })
})
