import { Observable } from '@cloudcare/browser-core'
import { trackConsoleError } from './trackConsoleError'

describe('trackConsoleError', () => {
  it('should forward console errors to the provided observable', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackConsoleError(errorObservable)

    errorObservable.subscribe(subscriber)
    console.error(new Error('console failure'))

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        source: 'console',
        handling: 'handled',
        message: 'Error: console failure'
      })
    )

    collection.stop()
  })

  it('should stop forwarding console errors after stop is called', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackConsoleError(errorObservable)

    errorObservable.subscribe(subscriber)
    collection.stop()
    console.error(new Error('console failure after stop'))

    expect(subscriber).not.toHaveBeenCalled()
  })

  it('should ignore non-error console methods', () => {
    const errorObservable = new Observable()
    const subscriber = jasmine.createSpy('subscriber')
    const collection = trackConsoleError(errorObservable)

    errorObservable.subscribe(subscriber)
    console.warn('not an error')

    expect(subscriber).not.toHaveBeenCalled()

    collection.stop()
  })
})
