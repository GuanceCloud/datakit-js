import { Observable } from '../helper/observable'
import { trackRuntimeError } from './trackRuntimeError'

describe('trackRuntimeError', () => {
  afterEach(() => {
    window.onerror = null
    window.onunhandledrejection = null
  })

  it('should notify unhandled promise rejections', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const errorObservable = new Observable()
    errorObservable.subscribe(subscriber)

    const collection = trackRuntimeError(errorObservable)
    const error = new Error('promise failed')

    window.onunhandledrejection({ reason: error })

    expect(subscriber).toHaveBeenCalledWith(
      jasmine.objectContaining({
        source: 'source',
        handling: 'unhandled',
        originalError: error,
        message: 'promise failed'
      })
    )

    collection.stop()
  })
})
