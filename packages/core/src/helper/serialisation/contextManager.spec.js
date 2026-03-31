import { createContextManager } from './contextManager'
import { display } from '../display'

describe('contextManager', () => {
  let customerDataTracker
  let contextManager

  beforeEach(() => {
    customerDataTracker = {
      updateCustomerData: jasmine.createSpy('updateCustomerData'),
      resetCustomerData: jasmine.createSpy('resetCustomerData')
    }
    contextManager = createContextManager('user', {
      customerDataTracker,
      propertiesConfig: {
        id: { required: true, type: 'string' },
        active: { required: false, type: 'string' }
      }
    })
  })

  it('should set and clone context values', () => {
    contextManager.setContext({
      id: 123,
      active: true
    })

    const context = contextManager.getContext()
    context.id = 'changed'

    expect(contextManager.getContext()).toEqual({
      id: '123',
      active: 'true'
    })
    expect(customerDataTracker.updateCustomerData).toHaveBeenCalledWith({
      id: '123',
      active: 'true'
    })
  })

  it('should clear context when a non-object is provided', () => {
    contextManager.setContext({ id: '123' })
    contextManager.setContext(undefined)

    expect(contextManager.getContext()).toEqual({})
    expect(customerDataTracker.resetCustomerData).toHaveBeenCalled()
  })

  it('should set and remove individual context properties', () => {
    contextManager.setContextProperty('id', 123)
    contextManager.setContextProperty('extra', { nested: true })

    expect(contextManager.getContext()).toEqual({
      id: '123',
      extra: { nested: true }
    })

    contextManager.removeContextProperty('extra')

    expect(contextManager.getContext()).toEqual({
      id: '123'
    })
  })

  it('should notify observers on every change', () => {
    const subscriber = jasmine.createSpy('subscriber')
    contextManager.changeObservable.subscribe(subscriber)

    contextManager.setContext({ id: '123' })
    contextManager.setContextProperty('extra', 'value')
    contextManager.removeContextProperty('extra')
    contextManager.clearContext()

    expect(subscriber).toHaveBeenCalledTimes(4)
  })

  it('should warn when required properties are missing', () => {
    spyOn(display, 'warn')

    contextManager.setContext({ active: true })
    contextManager.removeContextProperty('id')

    expect(display.warn).toHaveBeenCalled()
  })
})
