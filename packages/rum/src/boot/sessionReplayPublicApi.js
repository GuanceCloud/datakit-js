import { addTelemetryUsage, monitor } from '@cloudcare/browser-core'

export function makeSessionReplayPublicApi(recorderApi) {
  return {
    startSessionReplayRecording: monitor(function (options) {
      recorderApi.start(options)
      addTelemetryUsage({
        feature: 'start-session-replay-recording',
        force: options && options.force
      })
    }),
    isRecording: monitor(function () {
      return recorderApi.isRecording()
    }),
    stopSessionReplayRecording: monitor(recorderApi.stop),
    takeSubsequentFullSnapshot: monitor(recorderApi.takeSubsequentFullSnapshot),
    snapshotCanvas: monitor(function (canvas, options) {
      return recorderApi.snapshotCanvas(canvas, options)
    }),
    getSerializedNodeIdForDebug: monitor(function (node) {
      return recorderApi.getSerializedNodeIdForDebug(node)
    }),
    getLastAutoCanvasSnapshotResultForDebug: monitor(function () {
      return recorderApi.$rGetDebug(0)
    }),
    getAutoCanvasSnapshotDebugHistoryForDebug: monitor(function () {
      return recorderApi.$rGetDebug(1)
    }),
    getLastCanvasMutationForDebug: monitor(function () {
      return recorderApi.$rGetDebug(2)
    }),
    getCanvasMutationHistoryForDebug: monitor(function () {
      return recorderApi.$rGetDebug(3)
    }),
    getLastDomMutationForDebug: monitor(function () {
      return recorderApi.$rGetDebug(4)
    }),
    getDomMutationHistoryForDebug: monitor(function () {
      return recorderApi.$rGetDebug(5)
    }),
    getLastReplaySegmentFlushForDebug: monitor(function () {
      return recorderApi.$rGetDebug(6)
    }),
    getReplaySegmentFlushHistoryForDebug: monitor(function () {
      return recorderApi.$rGetDebug(7)
    }),
    getReplayPerformanceForDebug: monitor(function () {
      return recorderApi.$rGetDebug(8)
    }),
    flushReplayMutationsForDebug: monitor(function () {
      if (recorderApi.flushReplayMutationsForDebug) {
        recorderApi.flushReplayMutationsForDebug()
      }
    })
  }
}
