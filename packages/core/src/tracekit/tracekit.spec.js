import { startUnhandledErrorCollection } from './tracekit'

describe('tracekit', () => {
  afterEach(() => {
    window.onerror = null
    window.onunhandledrejection = null
  })

  it('should collect unhandled promise rejections', () => {
    const callback = jasmine.createSpy('callback')
    const collection = startUnhandledErrorCollection(callback)
    const error = new Error('promise failed')

    window.onunhandledrejection({ reason: error })

    expect(callback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        message: 'promise failed',
        name: 'Error'
      }),
      error
    )

    collection.stop()
  })

  it('should restore instrumented handlers when stopped', () => {
    const collection = startUnhandledErrorCollection(jasmine.createSpy('cb'))

    expect(typeof window.onerror).toBe('function')
    expect(typeof window.onunhandledrejection).toBe('function')

    collection.stop()

    expect(typeof window.onerror).toBe('function')
    expect(typeof window.onunhandledrejection).toBe('function')
  })
})
