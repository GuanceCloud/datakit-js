import {
  isWebGLReplayCanvas,
  markReplayInternalCanvas
} from './canvasContext'

var NOOP_OBSERVER = {
  isWebGLCanvas: isWebGLReplayCanvas,
  reset: function () {},
  stop: function () {}
}

export function createSessionReplayWebGLRuntime(
  configuration,
  baseEncodeBridge,
  report
) {
  var createRuntime = configuration.sessionReplayWebGL
  if (typeof createRuntime !== 'function') {
    return []
  }

  try {
    return (
      createRuntime(
        configuration,
        baseEncodeBridge,
        markReplayInternalCanvas,
        report
      ) || []
    )
  } catch (error) {
    try {
      if (report) {
        report('create_runtime', error)
      }
    } catch (_) {}
    return []
  }
}

export function createNoopObserver() {
  return NOOP_OBSERVER
}
