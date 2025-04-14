import { defineGlobal, getGlobalObject } from '@cloudcare/browser-core'
import { startRum } from './rum'
import { makeRumPublicApi } from './rumPublicApi'
import { startRecording } from './startRecording'
import { makeRecorderApi } from './recorderApi'
import { createDeflateEncoder, startDeflateWorker } from '../domain/deflate'
var recorderApi = makeRecorderApi(startRecording)
export var datafluxRum = makeRumPublicApi(startRum, recorderApi, {
  startDeflateWorker: startDeflateWorker,
  createDeflateEncoder: createDeflateEncoder
})

defineGlobal(getGlobalObject(), 'DATAFLUX_RUM', datafluxRum)
