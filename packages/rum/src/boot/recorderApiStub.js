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
  recorderApi.getLastAutoCanvasSnapshotResultForDebug = function () {
    return undefined
  }
  recorderApi.getAutoCanvasSnapshotDebugHistoryForDebug = function () {
    return undefined
  }
  recorderApi.getLastCanvasMutationForDebug = function () {
    return undefined
  }
  recorderApi.getCanvasMutationHistoryForDebug = function () {
    return undefined
  }
  recorderApi.getLastDomMutationForDebug = function () {
    return undefined
  }
  recorderApi.getDomMutationHistoryForDebug = function () {
    return undefined
  }
  recorderApi.getLastReplaySegmentFlushForDebug = function () {
    return undefined
  }
  recorderApi.getReplaySegmentFlushHistoryForDebug = function () {
    return undefined
  }
  recorderApi.getReplayPerformanceForDebug = function () {
    return undefined
  }
  recorderApi.flushReplayMutationsForDebug = noop
  return recorderApi
}
