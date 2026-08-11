import {
  createWebGLReplayConfiguration,
  createWebGLReplayRuntime,
  createWebGLReplaySnapshotPolicy
} from './webglReplayRuntime'

describe('WebGL replay runtime', () => {
  function createBaseBridge() {
    return {
      encode: jasmine
        .createSpy('encode')
        .and.resolveTo({ dataUrl: '2d' }),
      encodeWithLifecycle: jasmine
        .createSpy('encodeWithLifecycle')
        .and.callFake(function (canvas, options) {
          var result = Promise.resolve({ dataUrl: '2d', canvas, options })
          return { result: result, physicalSettled: result.then(function () {}) }
        }),
      reset: jasmine.createSpy('reset'),
      stop: jasmine.createSpy('stop')
    }
  }

  it('keeps legacy WebGL cadence defaults private from the faster 2d cadence', () => {
    var hostConfiguration = {
      replayCanvasAutoInterval: 250,
      replayCanvasAutoCooldown: 250
    }
    var webGLConfiguration = createWebGLReplayConfiguration(
      hostConfiguration,
      createWebGLReplaySnapshotPolicy({})
    )

    expect(webGLConfiguration.replayCanvasAutoInterval).toBe(1000)
    expect(webGLConfiguration.replayCanvasAutoCooldown).toBe(1000)
    expect(hostConfiguration.replayCanvasAutoInterval).toBe(250)
    expect(hostConfiguration.replayCanvasAutoCooldown).toBe(250)
    expect(Object.getPrototypeOf(webGLConfiguration)).toBe(
      hostConfiguration
    )
  })

  it('preserves legacy named-preset cadence for WebGL snapshots', () => {
    expect(
      createWebGLReplaySnapshotPolicy({ replayCanvasQuality: 'low' })
    ).toEqual([1500, 3000])
    expect(
      createWebGLReplaySnapshotPolicy({
        replayCanvasQuality: 'medium'
      })
    ).toEqual([1000, 2000])
    expect(
      createWebGLReplaySnapshotPolicy({ replayCanvasQuality: 'high' })
    ).toEqual([700, 1400])
  })

  it('honors explicit WebGL interval and cooldown independently', () => {
    expect(
      createWebGLReplaySnapshotPolicy({
        replayCanvasQuality: 'high',
        replayCanvasAutoInterval: 333
      })
    ).toEqual([333, 1400])
    expect(
      createWebGLReplaySnapshotPolicy({
        replayCanvasQuality: 'low',
        replayCanvasAutoCooldown: 444
      })
    ).toEqual([1500, 444])
  })

  it('keeps ordinary 2d encoding and lifecycle on the base bridge', async () => {
    var baseBridge = createBaseBridge()
    var runtime = createWebGLReplayRuntime(
      { replayCanvasMaxConcurrentEncodes: 1 },
      baseBridge,
      function (canvas) {
        return canvas
      },
      function () {}
    )
    var canvas = document.createElement('canvas')

    expect(runtime.length).toBe(2)
    expect(await runtime[0].encode(canvas)).toEqual({ dataUrl: '2d' })
    expect(baseBridge.encode).toHaveBeenCalledOnceWith(canvas, undefined)
    runtime[0].reset()
    runtime[0].stop()
    expect(baseBridge.reset).toHaveBeenCalledTimes(1)
    expect(baseBridge.stop).toHaveBeenCalledTimes(1)
  })

  it('creates a fresh safe observer after replay restarts', () => {
    var configuration = { replayCanvasEnabled: false }
    var first = createWebGLReplayRuntime(
      configuration,
      createBaseBridge(),
      function (canvas) {
        return canvas
      },
      function () {}
    )
    var second = createWebGLReplayRuntime(
      configuration,
      createBaseBridge(),
      function (canvas) {
        return canvas
      },
      function () {}
    )

    var firstObserver = first[1](function () {})
    firstObserver.stop()
    var secondObserver = second[1](function () {})
    expect(secondObserver).not.toBe(firstObserver)
    expect(function () {
      secondObserver.reset()
      secondObserver.stop()
    }).not.toThrow()
  })

  it('restores canvas wrappers after repeated command capture and WebGL replay cycles', () => {
    var cleanupRuntime = createWebGLReplayRuntime(
      { replayCanvasEnabled: false },
      createBaseBridge(),
      function (canvas) {
        return canvas
      },
      function () {}
    )
    cleanupRuntime[1](function () {}).stop()
    cleanupRuntime[0].stop()

    var canvasPrototype = window.HTMLCanvasElement.prototype
    var nativeGetContext = canvasPrototype.getContext
    var activeCycle

    function startCycle() {
      var runtime = createWebGLReplayRuntime(
        {
          replayCanvasEnabled: true,
          replayCanvasMode: 'auto',
          replayCanvasMaxConcurrentEncodes: 1
        },
        createBaseBridge(),
        function (canvas) {
          return canvas
        },
        function () {}
      )
      var webGLGetContext = canvasPrototype.getContext
      expect(webGLGetContext).not.toBe(nativeGetContext)

      var commandGetContext = function () {
        return webGLGetContext.apply(this, arguments)
      }
      canvasPrototype.getContext = commandGetContext
      var observer = runtime[1](function () {})
      expect(canvasPrototype.getContext).toBe(commandGetContext)

      return {
        stop: function () {
          if (canvasPrototype.getContext === commandGetContext) {
            canvasPrototype.getContext = webGLGetContext
          }
          observer.stop()
          runtime[0].stop()
        }
      }
    }

    try {
      activeCycle = startCycle()
      activeCycle.stop()
      activeCycle = undefined
      expect(canvasPrototype.getContext).toBe(nativeGetContext)

      activeCycle = startCycle()
      activeCycle.stop()
      activeCycle = undefined
      expect(canvasPrototype.getContext).toBe(nativeGetContext)
    } finally {
      if (activeCycle) {
        activeCycle.stop()
      }
      canvasPrototype.getContext = nativeGetContext
    }
  })
})
