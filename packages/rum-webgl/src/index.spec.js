import { datafluxRumWebGL, webglReplayPlugin } from './index'
import { startCanvasWebGLSnapshotObserver } from './canvasWebGLSnapshotObserver'

describe('webglReplayPlugin', () => {
  it('registers the private Session Replay WebGL runtime during init', () => {
    var plugin = webglReplayPlugin()
    var initConfiguration = { replayCanvasEnabled: false }

    expect(plugin.name).toBe('session-replay-webgl')
    expect(plugin.sessionReplayWebGL).toBeUndefined()
    plugin.onInit({ initConfiguration: initConfiguration })
    expect(initConfiguration.sessionReplayWebGL).toEqual(
      jasmine.any(Function)
    )
    expect(datafluxRumWebGL.webglReplayPlugin).toBe(webglReplayPlugin)
  })

  it('keeps duplicate official registration idempotent and rejects a conflicting runtime', () => {
    var first = webglReplayPlugin()
    var second = webglReplayPlugin()
    var initConfiguration = { replayCanvasEnabled: false }

    expect(first).not.toBe(second)
    first.onInit({ initConfiguration: initConfiguration })
    var registeredRuntime = initConfiguration.sessionReplayWebGL
    initConfiguration.replayCanvasQuality = 'high'
    second.onInit({ initConfiguration: initConfiguration })
    expect(initConfiguration.sessionReplayWebGL).toBe(registeredRuntime)

    initConfiguration.sessionReplayWebGL = function () {}
    first.onInit({ initConfiguration: initConfiguration })
    expect(initConfiguration.sessionReplayWebGL).toBeNull()
  })

  it('creates an isolated runtime wrapper for each init configuration', () => {
    var firstConfiguration = { replayCanvasEnabled: false }
    var secondConfiguration = {
      replayCanvasEnabled: false,
      replayCanvasQuality: 'high'
    }

    webglReplayPlugin().onInit({
      initConfiguration: firstConfiguration
    })
    webglReplayPlugin().onInit({
      initConfiguration: secondConfiguration
    })

    expect(firstConfiguration.sessionReplayWebGL).toEqual(
      jasmine.any(Function)
    )
    expect(secondConfiguration.sessionReplayWebGL).toEqual(
      jasmine.any(Function)
    )
    expect(firstConfiguration.sessionReplayWebGL).not.toBe(
      secondConfiguration.sessionReplayWebGL
    )
  })

  it('does not install bootstrap hooks when WebGL replay is disabled or manual', () => {
    var originalGetContext = HTMLCanvasElement.prototype.getContext
    var plugin = webglReplayPlugin()

    plugin.onInit({
      initConfiguration: {
        replayCanvasEnabled: false,
        replayCanvasMode: 'auto'
      }
    })
    expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext)

    plugin.onInit({
      initConfiguration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual'
      }
    })
    expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext)
  })

  it('keeps the early bootstrap hook for enabled auto WebGL replay', () => {
    var originalGetContext = HTMLCanvasElement.prototype.getContext
    var plugin = webglReplayPlugin()
    try {
      plugin.onInit({
        initConfiguration: {
          replayCanvasEnabled: true
        }
      })
      expect(HTMLCanvasElement.prototype.getContext).not.toBe(
        originalGetContext
      )
    } finally {
      startCanvasWebGLSnapshotObserver({
        configuration: {
          replayCanvasEnabled: false
        }
      })
    }
    expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext)
  })
})
