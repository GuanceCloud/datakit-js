import { ConsoleApiName } from '../helper/display'
import {
  initConsoleObservable,
  resetConsoleObservable
} from './consoleObservable'

describe('consoleObservable', () => {
  afterEach(() => {
    resetConsoleObservable()
  })

  it('should collect console log messages', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = initConsoleObservable([ConsoleApiName.log])
    const subscription = observable.subscribe(subscriber)

    console.log('hello', { value: 1 })

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        api: ConsoleApiName.log,
        message: 'hello {\n  "value": 1\n}',
        error: undefined
      })
    )

    subscription.unsubscribe()
  })

  it('should collect console errors with raw error information', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = initConsoleObservable([ConsoleApiName.error])
    const subscription = observable.subscribe(subscriber)

    console.error(new Error('boom'), 'context')

    const event = subscriber.calls.mostRecent().args[0]

    expect(event.api).toBe(ConsoleApiName.error)
    expect(event.message).toBe('Error: boom context')
    expect(event.error).toEqual(
      jasmine.objectContaining({
        message: 'Error: boom context',
        source: 'console',
        handling: 'handled'
      })
    )

    subscription.unsubscribe()
  })
})
