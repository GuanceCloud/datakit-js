import { addTelemetryUsage, monitor } from '@cloudcare/browser-core'

export function makeSessionReplayPublicApi(recorderApi) {
  function makeDebugGetter(debugIndex) {
    return monitor(function () {
      return recorderApi.$rGetDebug(debugIndex)
    })
  }

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
    getLastAutoCanvasSnapshotResultForDebug: makeDebugGetter(0),
    getAutoCanvasSnapshotDebugHistoryForDebug: makeDebugGetter(1),
    getLastCanvasMutationForDebug: makeDebugGetter(2),
    getCanvasMutationHistoryForDebug: makeDebugGetter(3),
    getLastDomMutationForDebug: makeDebugGetter(4),
    getDomMutationHistoryForDebug: makeDebugGetter(5),
    getLastReplaySegmentFlushForDebug: makeDebugGetter(6),
    getReplaySegmentFlushHistoryForDebug: makeDebugGetter(7),
    getReplayPerformanceForDebug: makeDebugGetter(8),
    flushReplayMutationsForDebug: monitor(function () {
      if (recorderApi.flushReplayMutationsForDebug) {
        recorderApi.flushReplayMutationsForDebug()
      }
    })
  }
}
