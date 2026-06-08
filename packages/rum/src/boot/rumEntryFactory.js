import { defineGlobal, getGlobalObject } from '@cloudcare/browser-core'
import { startRum } from './rum'
import { makeRumPublicApi } from './rumPublicApi'

export function makeRumEntry(recorderApi, options) {
  var datafluxRum = makeRumPublicApi(startRum, recorderApi, options)
  defineGlobal(getGlobalObject(), 'DATAFLUX_RUM', datafluxRum)
  return datafluxRum
}

