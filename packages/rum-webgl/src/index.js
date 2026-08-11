import { installCanvasWebGLSnapshotBootstrap } from './canvasWebGLSnapshotObserver'
import { createWebGLReplayRuntime } from './webglReplayRuntime'

export function webglReplayPlugin() {
  return {
    name: 'session-replay-webgl',
    onInit: function (context) {
      var initConfiguration = context && context.initConfiguration
      if (!initConfiguration) {
        return
      }
      var registeredRuntime = initConfiguration.sessionReplayWebGL
      initConfiguration.sessionReplayWebGL =
        registeredRuntime === undefined ||
        registeredRuntime === createWebGLReplayRuntime
          ? createWebGLReplayRuntime
          : null
      if (
        initConfiguration.replayCanvasEnabled !== true ||
        initConfiguration.replayCanvasMode === 'manual'
      ) {
        return
      }
      // Install before the recorder waits for DOM interactive so engines such
      // as Cocos can safely cache the wrapped GL methods during their boot.
      installCanvasWebGLSnapshotBootstrap({
        // The recorder may never start for a sampled-out session. Keep the
        // synchronous Cocos boot window, but do not leave draw/rAF prototypes
        // wrapped for the lifetime of a page that never owns an observer.
        bootstrapLeaseDuration: 30000
      })
    }
  }
}

export var datafluxRumWebGL = {
  webglReplayPlugin: webglReplayPlugin
}
