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
      return recorderApi.getLastAutoCanvasSnapshotResultForDebug()
    }),
    getAutoCanvasSnapshotDebugHistoryForDebug: monitor(function () {
      return recorderApi.getAutoCanvasSnapshotDebugHistoryForDebug()
    }),
    getLastCanvasMutationForDebug: monitor(function () {
      return recorderApi.getLastCanvasMutationForDebug()
    }),
    getCanvasMutationHistoryForDebug: monitor(function () {
      return recorderApi.getCanvasMutationHistoryForDebug()
    }),
    getLastDomMutationForDebug: monitor(function () {
      return recorderApi.getLastDomMutationForDebug()
    }),
    getDomMutationHistoryForDebug: monitor(function () {
      return recorderApi.getDomMutationHistoryForDebug()
    }),
    getLastReplaySegmentFlushForDebug: monitor(function () {
      return recorderApi.getLastReplaySegmentFlushForDebug()
    }),
    getReplaySegmentFlushHistoryForDebug: monitor(function () {
      return recorderApi.getReplaySegmentFlushHistoryForDebug()
    }),
    getReplayPerformanceForDebug: monitor(function () {
      return recorderApi.getReplayPerformanceForDebug()
    }),
    flushReplayMutationsForDebug: monitor(function () {
      if (recorderApi.flushReplayMutationsForDebug) {
        recorderApi.flushReplayMutationsForDebug()
      }
    })
  }
}

