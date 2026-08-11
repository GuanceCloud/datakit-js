import { assign, deepClone, getType } from '../tools'
import { sanitize } from '../sanitize'
import { Observable } from '../observable'
import { display } from '../display'

function ensureProperties(context, propertiesConfig, name) {
  const newContext = assign({}, context)

  Object.entries(propertiesConfig).forEach(function (propertyEntry) {
    const key = propertyEntry[0]
    const propertyConfiguration = propertyEntry[1]
    const required = propertyConfiguration.required
    const type = propertyConfiguration.type
    /**
     * Ensure specified properties are strings as defined here:
     */
    if (type === 'string' && key in newContext) {
      newContext[key] = String(newContext[key])
    }

    if (required && !(key in context)) {
      display.warn(
        `The property ${key} of ${name} context is required; context will not be sent to the intake.`
      )
    }
  })

  return newContext
}

export function createContextManager(
  name = '',
  { customerDataTracker, propertiesConfig = {} } = {}
) {
  let context = {}
  const changeObservable = new Observable()

  const contextManager = {
    getContext: () => deepClone(context),

    setContext: (newContext) => {
      if (getType(newContext) === 'object') {
        context = sanitize(ensureProperties(newContext, propertiesConfig, name))
        customerDataTracker?.updateCustomerData(context)
      } else {
        contextManager.clearContext()
      }
      changeObservable.notify()
    },

    setContextProperty: (key, property) => {
      const propertyContext = {}
      Object.defineProperty(propertyContext, key, {
        configurable: true,
        enumerable: true,
        value: property,
        writable: true
      })
      context[key] = sanitize(
        ensureProperties(propertyContext, propertiesConfig, name)[key]
      )
      customerDataTracker?.updateCustomerData(context)
      changeObservable.notify()
    },

    removeContextProperty: (key) => {
      delete context[key]
      customerDataTracker?.updateCustomerData(context)
      ensureProperties(context, propertiesConfig, name)
      changeObservable.notify()
    },

    clearContext: () => {
      context = {}
      customerDataTracker?.resetCustomerData()
      changeObservable.notify()
    },

    changeObservable
  }
  return contextManager
}
