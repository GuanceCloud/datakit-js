import { startCanvasWebGLSnapshotObserver } from './canvasWebGLSnapshotObserver'
import {
  getReplayCanvasContextType,
  setReplayCanvasContextType
} from './canvasContext'

describe('replay/record/canvasWebGLSnapshotObserver', () => {
  async function flushObserver() {
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
  }

  function createConfiguration(overrides) {
    return Object.assign(
      {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2,
        replayCanvasAutoInterval: 500,
        replayCanvasAutoCooldown: 500,
        replayCanvasAutoUnchangedBackoff: 1000,
        replayCanvasAutoFailureBackoff: 2000
      },
      overrides
    )
  }

  function createHarness(overrides) {
    overrides = overrides || {}
    var canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    var microtasks = []
    var nowTime = 0
    var visibilityState = 'visible'
    var visibilityChangeCallback
    var setTimeoutImpl = jasmine.createSpy('setTimeoutImpl')
    var fakePrototype = {
      drawArrays: jasmine.createSpy('drawArrays').and.returnValue('draw-result'),
      clear: jasmine.createSpy('clear')
    }
    if (overrides.extension) {
      fakePrototype.getExtension = jasmine
        .createSpy('getExtension')
        .and.returnValue(overrides.extension)
    }
    var originalDrawArrays = fakePrototype.drawArrays
    var originalClear = fakePrototype.clear
    var context = Object.create(fakePrototype)
    context.canvas = canvas
    var snapshotCanvas =
      overrides.snapshotCanvas ||
      jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(Promise.resolve({ ok: true }))
    var onDebug = jasmine.createSpy('onDebug')
    var observer = startCanvasWebGLSnapshotObserver({
      configuration: createConfiguration(overrides.configuration),
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      getSerializedNodeId:
        overrides.getSerializedNodeId ||
        function () {
          return 42
        },
      now:
        overrides.now ||
        function () {
          return nowTime
        },
      getCurrentTime: overrides.getCurrentTime,
      getVisibilityState:
        overrides.getVisibilityState ||
        function () {
          return visibilityState
        },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      setTimeoutImpl: setTimeoutImpl,
      contextPrototypeEntries:
        overrides.contextPrototypeEntries ||
        [
          {
            contextType: 'webgl',
            prototype: fakePrototype
          }
        ],
      canvasPrototype: overrides.canvasPrototype || {},
      animationFrameTarget: overrides.animationFrameTarget || {},
      addEventListenerImpl:
        overrides.addEventListenerImpl ||
        function (target, eventName, callback) {
          visibilityChangeCallback = callback
          return { stop: jasmine.createSpy('stop') }
        }
    })

    return {
      canvas: canvas,
      context: context,
      fakePrototype: fakePrototype,
      originalDrawArrays: originalDrawArrays,
      originalClear: originalClear,
      microtasks: microtasks,
      observer: observer,
      onDebug: onDebug,
      setTimeoutImpl: setTimeoutImpl,
      setNow: function (value) {
        nowTime = value
      },
      setVisibility: function (value) {
        visibilityState = value
        if (visibilityChangeCallback) {
          visibilityChangeCallback()
        }
      },
      snapshotCanvas: snapshotCanvas
    }
  }

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('should listen for visibility changes on document', () => {
    var addEventListenerImpl = jasmine
      .createSpy('addEventListener')
      .and.returnValue({ stop: jasmine.createSpy('stop') })
    var harness = createHarness({
      addEventListenerImpl: addEventListenerImpl
    })

    expect(addEventListenerImpl).toHaveBeenCalledWith(
      document,
      'visibilitychange',
      jasmine.any(Function),
      { capture: true }
    )

    harness.observer.stop()
  })

  it('should preserve the WebGL return value and coalesce draw calls per task', async () => {
    var harness = createHarness()

    expect(harness.context.drawArrays(4, 0, 3)).toBe('draw-result')
    harness.context.clear(1)

    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    await flushObserver()

    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(harness.snapshotCanvas).toHaveBeenCalledWith(
      harness.canvas,
      jasmine.objectContaining({
        scheduler: 'webgl_snapshot',
        contextType: 'webgl'
      })
    )
    expect(harness.onDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scheduler: 'webgl_snapshot',
        selectedCanvasCount: 1
      })
    )
    harness.observer.stop()
  })

  it('should skip repeated clock and visibility checks after a canvas is already queued', () => {
    var now = jasmine.createSpy('now').and.returnValue(0)
    var getVisibilityState = jasmine
      .createSpy('getVisibilityState')
      .and.returnValue('visible')
    var harness = createHarness({
      now: now,
      getVisibilityState: getVisibilityState
    })

    harness.context.drawArrays()
    var nowCallCount = now.calls.count()
    var visibilityCallCount = getVisibilityState.calls.count()
    for (var drawIndex = 0; drawIndex < 100; drawIndex += 1) {
      harness.context.drawArrays()
    }

    expect(now.calls.count()).toBe(nowCallCount)
    expect(getVisibilityState.calls.count()).toBe(visibilityCallCount)
    expect(harness.microtasks.length).toBe(1)
    harness.observer.stop()
  })

  it('should preserve a known WebGL2 context type through inherited WebGL draw hooks', async () => {
    var harness = createHarness()
    setReplayCanvasContextType(harness.canvas, 'webgl2')

    harness.context.drawArrays(4, 0, 3)
    harness.microtasks.shift()()
    await flushObserver()

    expect(harness.snapshotCanvas).toHaveBeenCalledWith(
      harness.canvas,
      jasmine.objectContaining({
        scheduler: 'webgl_snapshot',
        contextType: 'webgl2'
      })
    )
    harness.observer.stop()
  })

  it('should correct a stale WebGL classification when a 2d context is returned', () => {
    var canvas = document.createElement('canvas')
    var context2d = { canvas: canvas }
    var canvasPrototype = {
      getContext: jasmine
        .createSpy('getContext')
        .and.callFake(function (contextType) {
          return contextType === '2d' ? context2d : null
        })
    }
    setReplayCanvasContextType(canvas, 'webgl')
    var harness = createHarness({ canvasPrototype: canvasPrototype })

    expect(canvasPrototype.getContext.call(canvas, '2d')).toBe(context2d)
    expect(getReplayCanvasContextType(canvas)).toBe('2d')

    harness.observer.stop()
  })

  it('should observe extension draw methods without changing extension identity', async () => {
    var originalExtensionDraw = jasmine
      .createSpy('drawArraysInstancedANGLE')
      .and.returnValue('extension-result')
    var extensionPrototype = {
      drawArraysInstancedANGLE: originalExtensionDraw
    }
    var extension = Object.create(extensionPrototype)
    var harness = createHarness({ extension: extension })

    expect(harness.context.getExtension('ANGLE_instanced_arrays')).toBe(
      extension
    )
    expect(extension.drawArraysInstancedANGLE(4, 0, 3, 2)).toBe(
      'extension-result'
    )
    expect(harness.microtasks.length).toBe(1)

    harness.microtasks.shift()()
    await flushObserver()

    expect(originalExtensionDraw).toHaveBeenCalledWith(4, 0, 3, 2)
    expect(harness.snapshotCanvas).toHaveBeenCalledWith(
      harness.canvas,
      jasmine.objectContaining({
        scheduler: 'webgl_snapshot',
        contextType: 'webgl'
      })
    )

    harness.observer.stop()
    expect(extensionPrototype.drawArraysInstancedANGLE).toBe(
      originalExtensionDraw
    )
  })

  it('should wait for an eligible draw and capture it at the requestAnimationFrame boundary', async () => {
    var queuedAnimationFrameCallbacks = []
    var animationFrameTarget = {
      requestAnimationFrame: jasmine
        .createSpy('requestAnimationFrame')
        .and.callFake(function (callback) {
          queuedAnimationFrameCallbacks.push(callback)
          return queuedAnimationFrameCallbacks.length
        })
    }
    var harness = createHarness({
      animationFrameTarget: animationFrameTarget
    })

    animationFrameTarget.requestAnimationFrame(function () {
      harness.context.drawArrays()
    })
    queuedAnimationFrameCallbacks.shift()(0)
    await flushObserver()

    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    harness.setNow(100)
    animationFrameTarget.requestAnimationFrame(function () {
      harness.context.drawArrays()
    })
    queuedAnimationFrameCallbacks.shift()(100)
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(harness.microtasks.length).toBe(0)
    expect(harness.setTimeoutImpl).not.toHaveBeenCalled()

    harness.setNow(500)
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(harness.setTimeoutImpl).not.toHaveBeenCalled()

    animationFrameTarget.requestAnimationFrame(function () {
      harness.context.drawArrays()
      expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    })
    queuedAnimationFrameCallbacks.shift()(500)
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(2)
    expect(harness.microtasks.length).toBe(0)
    harness.observer.stop()
  })

  it('should snapshot synchronously when a requestAnimationFrame callback completes', async () => {
    var queuedAnimationFrameCallback
    var animationFrameTarget = {
      requestAnimationFrame: jasmine
        .createSpy('requestAnimationFrame')
        .and.callFake(function (callback) {
          queuedAnimationFrameCallback = callback
          return 17
        })
    }
    var originalRequestAnimationFrame =
      animationFrameTarget.requestAnimationFrame
    var harness = createHarness({
      animationFrameTarget: animationFrameTarget
    })
    var render = jasmine.createSpy('render').and.callFake(function () {
      harness.context.drawArrays()
      expect(harness.snapshotCanvas).not.toHaveBeenCalled()
    })

    expect(animationFrameTarget.requestAnimationFrame(render)).toBe(17)
    queuedAnimationFrameCallback(12)

    expect(render).toHaveBeenCalledWith(12)
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(harness.microtasks.length).toBe(0)

    await flushObserver()
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)

    harness.observer.stop()
    expect(animationFrameTarget.requestAnimationFrame).toBe(
      originalRequestAnimationFrame
    )
  })

  it('should keep task-end capture for draws outside a patched requestAnimationFrame callback', async () => {
    var animationFrameTarget = {
      requestAnimationFrame: jasmine.createSpy('requestAnimationFrame')
    }
    var harness = createHarness({
      animationFrameTarget: animationFrameTarget
    })

    harness.context.drawArrays()

    expect(harness.snapshotCanvas).not.toHaveBeenCalled()
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    await flushObserver()
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    harness.observer.stop()
  })

  it('should apply success cooldown before scheduling another snapshot', async () => {
    var harness = createHarness()

    harness.context.drawArrays()
    harness.microtasks.shift()()
    await flushObserver()

    harness.setNow(100)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.setNow(500)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.observer.stop()
  })

  it('should measure the success cadence from the snapshot start time', async () => {
    var resolveSnapshot
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(
        new Promise(function (resolve) {
          resolveSnapshot = resolve
        })
      )
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoCooldown: 40
      }
    })

    harness.context.drawArrays()
    harness.microtasks.shift()()
    harness.setNow(200)
    resolveSnapshot({ ok: true })
    await flushObserver()

    harness.setNow(499)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.setNow(500)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.observer.stop()
  })

  it('should reduce capture cadence when synchronous WebGL staging exceeds its budget', async () => {
    var currentTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function () {
        currentTime = 6
        return Promise.resolve({ ok: true })
      })
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      getCurrentTime: function () {
        return currentTime
      },
      configuration: {
        replayCanvasAutoInterval: 100,
        replayCanvasAutoCooldown: 1
      }
    })

    harness.context.drawArrays()
    harness.microtasks.shift()()
    await flushObserver()

    harness.setNow(299)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.setNow(300)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.observer.stop()
  })

  it('should apply success cooldown after the snapshot completes', async () => {
    var resolveSnapshot
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(
        new Promise(function (resolve) {
          resolveSnapshot = resolve
        })
      )
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoCooldown: 300
      }
    })

    harness.context.drawArrays()
    harness.microtasks.shift()()
    harness.setNow(400)
    resolveSnapshot({ ok: true })
    await flushObserver()

    harness.setNow(699)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.setNow(700)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.observer.stop()
  })

  ;['unchanged', 'below_threshold'].forEach(function (reason) {
    it('should apply the ' + reason + ' backoff after completion', async () => {
      var resolveSnapshot
      var snapshotCanvas = jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(
          new Promise(function (resolve) {
            resolveSnapshot = resolve
          })
        )
      var harness = createHarness({ snapshotCanvas: snapshotCanvas })

      harness.context.drawArrays()
      harness.microtasks.shift()()
      harness.setNow(200)
      resolveSnapshot({ ok: false, reason: reason })
      await flushObserver()

      harness.setNow(1199)
      harness.context.drawArrays()
      expect(harness.microtasks.length).toBe(0)

      harness.setNow(1200)
      harness.context.drawArrays()
      expect(harness.microtasks.length).toBe(1)
      harness.observer.stop()
    })
  })

  it('should use the failure backoff after an encode failure', async () => {
    var resolveSnapshot
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(
        new Promise(function (resolve) {
          resolveSnapshot = resolve
        })
      )
    var harness = createHarness({ snapshotCanvas: snapshotCanvas })

    harness.context.drawArrays()
    harness.microtasks.shift()()
    harness.setNow(200)
    resolveSnapshot({ ok: false, reason: 'encode_failed' })
    await flushObserver()

    harness.setNow(2199)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.setNow(2200)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.observer.stop()
  })

  it('should wait for another draw when a canvas cannot use the current encoder slot', async () => {
    var snapshotResolvers = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }
    })
    var secondCanvas = document.createElement('canvas')
    document.body.appendChild(secondCanvas)
    var secondContext = Object.create(harness.fakePrototype)
    secondContext.canvas = secondCanvas

    harness.context.drawArrays()
    secondContext.drawArrays()

    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    expect(snapshotCanvas.calls.count()).toBe(1)

    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    expect(harness.microtasks.length).toBe(0)
    expect(snapshotCanvas.calls.count()).toBe(1)

    harness.setNow(500)
    secondContext.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    expect(harness.snapshotCanvas.calls.count()).toBe(2)

    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should rotate a single encoder slot across canvases with a fixed draw order', async () => {
    var queuedAnimationFrameCallbacks = []
    var animationFrameTarget = {
      requestAnimationFrame: jasmine
        .createSpy('requestAnimationFrame')
        .and.callFake(function (callback) {
          queuedAnimationFrameCallbacks.push(callback)
          return queuedAnimationFrameCallbacks.length
        })
    }
    var snapshotResolvers = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      animationFrameTarget: animationFrameTarget,
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }
    })
    var secondCanvas = document.createElement('canvas')
    document.body.appendChild(secondCanvas)
    var secondContext = Object.create(harness.fakePrototype)
    secondContext.canvas = secondCanvas

    animationFrameTarget.requestAnimationFrame(function () {
      harness.context.drawArrays()
    })
    animationFrameTarget.requestAnimationFrame(function () {
      secondContext.drawArrays()
    })
    queuedAnimationFrameCallbacks.shift()(0)
    queuedAnimationFrameCallbacks.shift()(0)

    expect(harness.snapshotCanvas.calls.count()).toBe(1)
    expect(harness.snapshotCanvas.calls.argsFor(0)[0]).toBe(harness.canvas)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()

    harness.setNow(500)
    animationFrameTarget.requestAnimationFrame(function () {
      harness.context.drawArrays()
    })
    animationFrameTarget.requestAnimationFrame(function () {
      secondContext.drawArrays()
    })
    queuedAnimationFrameCallbacks.shift()(500)
    expect(harness.snapshotCanvas.calls.count()).toBe(1)
    queuedAnimationFrameCallbacks.shift()(500)

    expect(harness.snapshotCanvas.calls.count()).toBe(2)
    expect(harness.snapshotCanvas.calls.argsFor(1)[0]).toBe(secondCanvas)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should expire a stopped canvas reservation without capturing another stale frame', async () => {
    var queuedAnimationFrameCallbacks = []
    var animationFrameTarget = {
      requestAnimationFrame: jasmine
        .createSpy('requestAnimationFrame')
        .and.callFake(function (callback) {
          queuedAnimationFrameCallbacks.push(callback)
          return queuedAnimationFrameCallbacks.length
        })
    }
    var snapshotResolvers = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      animationFrameTarget: animationFrameTarget,
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }
    })
    var stoppedCanvas = document.createElement('canvas')
    var survivingCanvas = document.createElement('canvas')
    document.body.appendChild(stoppedCanvas)
    document.body.appendChild(survivingCanvas)
    var stoppedContext = Object.create(harness.fakePrototype)
    var survivingContext = Object.create(harness.fakePrototype)
    stoppedContext.canvas = stoppedCanvas
    survivingContext.canvas = survivingCanvas

    ;[
      harness.context,
      stoppedContext,
      survivingContext
    ].forEach(function (context) {
      animationFrameTarget.requestAnimationFrame(function () {
        context.drawArrays()
      })
    })
    while (queuedAnimationFrameCallbacks.length) {
      queuedAnimationFrameCallbacks.shift()(0)
    }
    expect(snapshotCanvas.calls.count()).toBe(1)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()

    harness.setNow(500)
    ;[harness.context, survivingContext].forEach(function (context) {
      animationFrameTarget.requestAnimationFrame(function () {
        context.drawArrays()
      })
    })
    queuedAnimationFrameCallbacks.shift()(500)
    queuedAnimationFrameCallbacks.shift()(500)
    expect(snapshotCanvas.calls.count()).toBe(1)

    harness.setNow(1000)
    ;[harness.context, survivingContext].forEach(function (context) {
      animationFrameTarget.requestAnimationFrame(function () {
        context.drawArrays()
      })
    })
    queuedAnimationFrameCallbacks.shift()(1000)
    expect(snapshotCanvas.calls.count()).toBe(1)
    queuedAnimationFrameCallbacks.shift()(1000)

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(snapshotCanvas.calls.argsFor(1)[0]).toBe(survivingCanvas)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should keep a reserved canvas through every callback in the same animation frame', async () => {
    var queuedAnimationFrameCallbacks = []
    var animationFrameTarget = {
      requestAnimationFrame: jasmine
        .createSpy('requestAnimationFrame')
        .and.callFake(function (callback) {
          queuedAnimationFrameCallbacks.push(callback)
          return queuedAnimationFrameCallbacks.length
        })
    }
    var snapshotResolvers = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      animationFrameTarget: animationFrameTarget,
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }
    })
    var secondCanvas = document.createElement('canvas')
    var thirdCanvas = document.createElement('canvas')
    var fourthCanvas = document.createElement('canvas')
    document.body.appendChild(secondCanvas)
    document.body.appendChild(thirdCanvas)
    document.body.appendChild(fourthCanvas)
    var secondContext = Object.create(harness.fakePrototype)
    var thirdContext = Object.create(harness.fakePrototype)
    var fourthContext = Object.create(harness.fakePrototype)
    secondContext.canvas = secondCanvas
    thirdContext.canvas = thirdCanvas
    fourthContext.canvas = fourthCanvas

    ;[
      harness.context,
      secondContext,
      thirdContext,
      fourthContext
    ].forEach(function (context) {
      animationFrameTarget.requestAnimationFrame(function () {
        context.drawArrays()
      })
    })
    while (queuedAnimationFrameCallbacks.length) {
      queuedAnimationFrameCallbacks.shift()(0)
    }
    expect(snapshotCanvas.calls.count()).toBe(1)
    expect(snapshotCanvas.calls.argsFor(0)[0]).toBe(harness.canvas)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()

    harness.setNow(500)
    ;[
      harness.context,
      thirdContext,
      fourthContext,
      secondContext
    ].forEach(function (context) {
      animationFrameTarget.requestAnimationFrame(function () {
        context.drawArrays()
      })
    })
    while (queuedAnimationFrameCallbacks.length) {
      queuedAnimationFrameCallbacks.shift()(500)
    }

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(snapshotCanvas.calls.argsFor(1)[0]).toBe(secondCanvas)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should not capture a busy-slot draw until a subsequent real draw', async () => {
    var snapshotResolvers = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      configuration: {
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }
    })
    var secondCanvas = document.createElement('canvas')
    document.body.appendChild(secondCanvas)
    var secondContext = Object.create(harness.fakePrototype)
    secondContext.canvas = secondCanvas

    harness.context.drawArrays()
    harness.microtasks.shift()()
    expect(snapshotCanvas.calls.count()).toBe(1)

    secondContext.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    expect(harness.microtasks.length).toBe(0)
    expect(snapshotCanvas.calls.count()).toBe(1)

    harness.setNow(500)
    expect(snapshotCanvas.calls.count()).toBe(1)

    secondContext.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(snapshotCanvas.calls.mostRecent().args[0]).toBe(secondCanvas)

    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should bound the pending queue and accept a later draw after overflow', async () => {
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      getCurrentTime: function () {
        return 0
      },
      configuration: {
        replayCanvasAutoMaxPerRun: 10,
        replayCanvasMaxConcurrentEncodes: 10
      }
    })
    var contexts = [harness.context]
    for (var canvasIndex = 1; canvasIndex < 51; canvasIndex += 1) {
      var canvas = document.createElement('canvas')
      document.body.appendChild(canvas)
      var context = Object.create(harness.fakePrototype)
      context.canvas = canvas
      contexts.push(context)
    }

    contexts.forEach(function (context) {
      context.drawArrays()
    })
    var overflowContext = contexts[contexts.length - 1]
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    for (var drainRound = 0; drainRound < 20; drainRound += 1) {
      await flushObserver()
      while (harness.microtasks.length) {
        harness.microtasks.shift()()
        await flushObserver()
      }
    }

    expect(snapshotCanvas.calls.count()).toBe(4)
    expect(harness.microtasks.length).toBe(0)
    expect(
      snapshotCanvas.calls.allArgs().some(function (args) {
        return args[0] === overflowContext.canvas
      })
    ).toBeFalse()

    overflowContext.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    await flushObserver()

    expect(snapshotCanvas.calls.count()).toBe(5)
    expect(snapshotCanvas).toHaveBeenCalledWith(
      overflowContext.canvas,
      jasmine.objectContaining({ scheduler: 'webgl_snapshot' })
    )
    harness.observer.stop()
  })

  it('should wait for a post-completion eligible draw after an in-flight draw', async () => {
    var snapshotResolvers = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas
    })

    harness.context.drawArrays()
    harness.microtasks.shift()()
    expect(snapshotCanvas.calls.count()).toBe(1)

    for (var drawIndex = 0; drawIndex < 20; drawIndex += 1) {
      harness.context.drawArrays()
    }
    expect(harness.microtasks.length).toBe(0)

    harness.setNow(200)
    snapshotResolvers.shift()({ ok: true })
    await flushObserver()

    expect(harness.microtasks.length).toBe(0)
    harness.setNow(700)
    expect(snapshotCanvas.calls.count()).toBe(1)

    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    expect(harness.snapshotCanvas.calls.count()).toBe(2)

    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should clear a cooldown dirty frame on visibility reset', async () => {
    var harness = createHarness()

    harness.context.drawArrays()
    harness.microtasks.shift()()
    await flushObserver()

    harness.setNow(100)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.setVisibility('hidden')
    harness.setNow(500)
    harness.setVisibility('visible')
    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(harness.microtasks.length).toBe(0)

    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(1)
    harness.microtasks.shift()()
    expect(harness.snapshotCanvas.calls.count()).toBe(2)
    await flushObserver()
    harness.observer.stop()
  })

  it('should discard a cooldown dirty frame when stopped', async () => {
    var harness = createHarness()

    harness.context.drawArrays()
    harness.microtasks.shift()()
    await flushObserver()

    harness.setNow(100)
    harness.context.drawArrays()
    expect(harness.microtasks.length).toBe(0)

    harness.observer.stop()
    harness.setNow(500)
    harness.context.drawArrays()

    expect(harness.snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(harness.microtasks.length).toBe(0)
  })

  it('should continue after applying one synchronous capture budget to a drain', async () => {
    var currentTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function () {
        currentTime += 1.1
        return Promise.resolve({ ok: true })
      })
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      getCurrentTime: function () {
        return currentTime
      },
      configuration: {
        replayCanvasAutoMaxPerRun: 4,
        replayCanvasMaxConcurrentEncodes: 4
      }
    })
    var contexts = [harness.context]
    for (var canvasIndex = 1; canvasIndex < 4; canvasIndex += 1) {
      var canvas = document.createElement('canvas')
      document.body.appendChild(canvas)
      var context = Object.create(harness.fakePrototype)
      context.canvas = canvas
      contexts.push(context)
    }

    contexts.forEach(function (context) {
      context.drawArrays()
    })
    harness.microtasks.shift()()
    await flushObserver()

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(harness.microtasks.length).toBe(1)

    harness.microtasks.shift()()
    await flushObserver()

    expect(snapshotCanvas.calls.count()).toBe(4)
    expect(snapshotCanvas).toHaveBeenCalledWith(
      contexts[3].canvas,
      jasmine.objectContaining({ scheduler: 'webgl_snapshot' })
    )
    harness.observer.stop()
  })

  it('should not recheck shouldRecordCanvas on the queued and in-flight draw hot path', async () => {
    var snapshotResolvers = []
    var shouldRecordCanvas = jasmine
      .createSpy('shouldRecordCanvas')
      .and.returnValue(true)
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      }
    )
    var harness = createHarness({
      snapshotCanvas: snapshotCanvas,
      configuration: {
        shouldRecordCanvas: shouldRecordCanvas
      }
    })

    harness.context.drawArrays()
    for (var queuedDrawIndex = 0; queuedDrawIndex < 20; queuedDrawIndex += 1) {
      harness.context.drawArrays()
    }
    expect(shouldRecordCanvas).toHaveBeenCalledTimes(1)

    harness.microtasks.shift()()
    for (
      var inFlightDrawIndex = 0;
      inFlightDrawIndex < 20;
      inFlightDrawIndex += 1
    ) {
      harness.context.drawArrays()
    }
    expect(shouldRecordCanvas).toHaveBeenCalledTimes(1)

    snapshotResolvers.shift()({ ok: true })
    await flushObserver()
    harness.observer.stop()
  })

  it('should cache shouldRecordCanvas rejection briefly before rechecking it', () => {
    var shouldRecordCanvas = jasmine
      .createSpy('shouldRecordCanvas')
      .and.returnValue(false)
    var harness = createHarness({
      configuration: {
        shouldRecordCanvas: shouldRecordCanvas
      }
    })

    for (var drawIndex = 0; drawIndex < 20; drawIndex += 1) {
      harness.context.drawArrays()
    }
    expect(shouldRecordCanvas).toHaveBeenCalledTimes(1)

    harness.setNow(999)
    harness.context.drawArrays()
    expect(shouldRecordCanvas).toHaveBeenCalledTimes(1)

    harness.setNow(1000)
    harness.context.drawArrays()
    expect(shouldRecordCanvas).toHaveBeenCalledTimes(2)
    harness.observer.stop()
  })

  it('should restore patched methods on stop', () => {
    var harness = createHarness()
    var patchedDrawArrays = harness.fakePrototype.drawArrays

    harness.observer.stop()

    expect(harness.fakePrototype.drawArrays).not.toBe(patchedDrawArrays)
    harness.fakePrototype.drawArrays.call(harness.context)
    expect(harness.microtasks.length).toBe(0)
  })

  it('should isolate listener and draw method restore failures on stop', () => {
    var listenerStop = jasmine.createSpy('listenerStop').and.callFake(function () {
      throw new Error('listener stop failed')
    })
    var harness = createHarness({
      addEventListenerImpl: function () {
        return { stop: listenerStop }
      }
    })
    var nativeDefineProperty = Object.defineProperty
    spyOn(Object, 'defineProperty').and.callFake(function (
      target,
      property,
      descriptor
    ) {
      if (
        target === harness.fakePrototype &&
        property === 'drawArrays' &&
        descriptor.value === harness.originalDrawArrays
      ) {
        throw new Error('restore failed')
      }
      return nativeDefineProperty(target, property, descriptor)
    })

    expect(function () {
      harness.observer.stop()
    }).not.toThrow()

    expect(listenerStop).toHaveBeenCalled()
    expect(harness.fakePrototype.clear).toBe(harness.originalClear)
  })

  it('should skip canvases rejected by shouldRecordCanvas', () => {
    var harness = createHarness({
      configuration: {
        shouldRecordCanvas: function () {
          return false
        }
      }
    })

    harness.context.drawArrays()

    expect(harness.microtasks.length).toBe(0)
    harness.observer.stop()
  })

  it('should observe an existing native WebGL context when the browser exposes one', async () => {
    var canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    var context = canvas.getContext('webgl', {
      preserveDrawingBuffer: false
    })
    if (!context) {
      pending('WebGL is not available in this Chrome runtime')
      return
    }
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var observer = startCanvasWebGLSnapshotObserver({
      configuration: createConfiguration(),
      snapshotCanvas: snapshotCanvas,
      animationFrameTarget: {}
    })

    try {
      context.clearColor(1, 0, 0, 1)
      context.clear(context.COLOR_BUFFER_BIT)
      await flushObserver()

      expect(snapshotCanvas).toHaveBeenCalledWith(
        canvas,
        jasmine.objectContaining({
          scheduler: 'webgl_snapshot',
          contextType: 'webgl'
        })
      )
    } finally {
      observer.stop()
    }
  })
})
