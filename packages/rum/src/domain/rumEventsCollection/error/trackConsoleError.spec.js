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
})
