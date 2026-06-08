import { startRecording } from './startRecording'
import { makeRecorderApi } from './recorderApi'
import { createDeflateEncoder, startDeflateWorker } from '../domain/deflate'
import { makeRumEntry } from './rumEntryFactory'
import { makeSessionReplayPublicApi } from './sessionReplayPublicApi'
var recorderApi = makeRecorderApi(startRecording)
export var datafluxRum = makeRumEntry(recorderApi, {
  startCompressionWorker: startDeflateWorker,
  createCompressionEncoder: createDeflateEncoder,
  makeRecorderPublicApi: makeSessionReplayPublicApi
})
