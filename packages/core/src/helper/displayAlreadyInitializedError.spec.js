import { displayAlreadyInitializedError } from './displayAlreadyInitializedError'
import { display } from './display'

describe('displayAlreadyInitializedError', () => {
  it('should log an error when silentMultipleInit is disabled', () => {
    const displayErrorSpy = spyOn(display, 'error')

    displayAlreadyInitializedError('SDK', {})

    expect(displayErrorSpy).toHaveBeenCalledWith('SDK is already initialized.')
  })

  it('should stay silent when silentMultipleInit is enabled', () => {
    const displayErrorSpy = spyOn(display, 'error')

    displayAlreadyInitializedError('SDK', { silentMultipleInit: true })

    expect(displayErrorSpy).not.toHaveBeenCalled()
  })
})
