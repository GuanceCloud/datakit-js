import { DOM_EVENT } from '../enums'
import { map, extend2Lev, isString } from '../tools'
import { addEventListener } from '../../browser/addEventListener'
var CONTEXT_STORE_KEY_PREFIX = '_gc_s'

var storageListeners = []

export function storeContextManager(
  configuration,
  contextManager,
  productKey,
  customerDataType
) {
  var storageKey = buildStorageKey(configuration, productKey, customerDataType)

  storageListeners.push(
    addEventListener(window, DOM_EVENT.STORAGE, function (params) {
      if (storageKey === params.key) {
        synchronizeWithStorage()
      }
    })
  )
  contextManager.changeObservable.subscribe(dumpToStorage)
  contextManager.setContext(
    extend2Lev(getFromStorage(), contextManager.getContext())
  )
  function synchronizeWithStorage() {
    contextManager.setContext(getFromStorage())
  }
  function dumpToStorage() {
    localStorage.setItem(
      storageKey,
      JSON.stringify(contextManager.getContext())
    )
  }
  function getFromStorage() {
    const rawContext = localStorage.getItem(storageKey)
    return rawContext !== null ? JSON.parse(rawContext) : {}
  }
  return contextManager
}

export function buildStorageKey(configuration, productKey, customerDataType) {
  // storeContextsKey
  if (
    configuration.storeContextsKey &&
    isString(configuration.storeContextsKey)
  ) {
    return (
      CONTEXT_STORE_KEY_PREFIX +
      '_' +
      productKey +
      '_' +
      customerDataType +
      '_' +
      configuration.storeContextsKey
    )
  } else {
    return CONTEXT_STORE_KEY_PREFIX + '_' + productKey + '_' + customerDataType
  }
}

export function removeStorageListeners() {
  map(storageListeners, function (listener) {
    listener.stop()
  })
}
