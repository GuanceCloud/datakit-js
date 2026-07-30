import { noop } from '@cloudcare/browser-core'
import { makeRumRecorderApiStub } from './rumRecorderApiStub'

export function makeRecorderApiStub() {
  var recorderApi = makeRumRecorderApiStub()
  recorderApi.start = noop
  recorderApi.stop = noop
  recorderApi.takeSubsequentFullSnapshot = noop
  recorderApi.snapshotCanvas = function () {
    return Promise.resolve({
      ok: false,
      reason: 'not_recording'
    })
  }
  recorderApi.getSerializedNodeIdForDebug = function () {
    return undefined
  }
  recorderApi.$rGetDebug = noop
  recorderApi.flushReplayMutationsForDebug = noop
  return recorderApi
}
