import { runOnReadyState } from './runOnReadyState'

describe('runOnReadyState', () => {
  let originalReadyState

  beforeEach(() => {
    originalReadyState = document.readyState
  })

  afterEach(() => {
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: originalReadyState
    })
  })

  it('should run immediately when the expected ready state is already reached', () => {
    const callback = jasmine.createSpy('callback')
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'complete'
    })

    const subscription = runOnReadyState('interactive', callback)

    expect(callback).toHaveBeenCalledTimes(1)
    expect(typeof subscription.stop).toBe('function')
  })

  it('should wait for the matching DOM event otherwise', () => {
    const callback = jasmine.createSpy('callback')
    Object.defineProperty(document, 'readyState', {
      configurable: true,
      value: 'loading'
    })

    runOnReadyState('interactive', callback)
    expect(callback).not.toHaveBeenCalled()

    window.dispatchEvent(new Event('DOMContentLoaded'))

    expect(callback).toHaveBeenCalledTimes(1)
  })
})
