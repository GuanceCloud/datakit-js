import {
  installCanvasWebGLSnapshotBootstrap,
  startCanvasWebGLSnapshotObserver
} from './canvasWebGLSnapshotObserver'

describe('canvas WebGL snapshot observer addon', () => {
  function createObserverOptions(overrides) {
    var contextTypes = new WeakMap()
    var contextPrototype = {
      drawArrays: function () {},
      getExtension: function () {}
    }
    var canvasPrototype = {
      getContext: function () {
        return {}
      }
    }
    var options = {
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 20,
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      },
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: contextPrototype }
      ],
      canvasPrototype: canvasPrototype,
      animationFrameTarget: null,
      getVisibilityState: function () {
        return 'visible'
      },
      addEventListenerImpl: function () {
        return { stop: function () {} }
      },
      hostSnapshotCanvas: jasmine
        .createSpy('hostSnapshotCanvas')
        .and.resolveTo({ ok: true }),
      hostGetSerializedNodeId: function () {
        return 42
      },
      hostOnDebug: jasmine.createSpy('hostOnDebug'),
      hostGetCanvasContextType: function (canvas) {
        return contextTypes.get(canvas)
      },
      hostSetCanvasContextType: function (canvas, contextType) {
        contextTypes.set(canvas, contextType)
      },
      hostNormalizeCanvasContextType: function (contextType) {
        return contextType === 'webgl' || contextType === 'webgl2'
          ? contextType
          : contextType === '2d'
            ? '2d'
            : undefined
      },
      hostIsInternalCanvas: function () {
        return false
      },
      hostShouldRecordCanvas: function () {
        return true
      }
    }
    Object.assign(options, overrides)
    return {
      options: options,
      contextPrototype: contextPrototype,
      canvasPrototype: canvasPrototype,
      contextTypes: contextTypes
    }
  }

  function createTimerHarness() {
    var currentTime = 0
    var nextTimerId = 0
    var timers = []

    function runDueTimers() {
      var dueTimer
      do {
        timers.sort(function (left, right) {
          return left.at - right.at || left.id - right.id
        })
        dueTimer = timers.find(function (timer) {
          return !timer.cancelled && timer.at <= currentTime
        })
        if (dueTimer) {
          dueTimer.cancelled = true
          dueTimer.callback()
        }
      } while (dueTimer)
    }

    return {
      now: function () {
        return currentTime
      },
      setTimeoutImpl: function (callback, delay) {
        var timer = {
          id: ++nextTimerId,
          at: currentTime + Math.max(delay || 0, 0),
          callback: callback,
          cancelled: false
        }
        timers.push(timer)
        return timer
      },
      clearTimeoutImpl: function (timer) {
        timer.cancelled = true
      },
      advanceBy: function (duration) {
        currentTime += duration
        runDueTimers()
      }
    }
  }

  async function flushMicrotasks(turnCount) {
    for (var turn = 0; turn < (turnCount || 20); turn += 1) {
      await Promise.resolve()
    }
  }

  it('uses host context hooks and snapshots a patched WebGL draw', async () => {
    var fixture = createObserverOptions()
    var originalDrawArrays = fixture.contextPrototype.drawArrays
    var canvas = document.createElement('canvas')
    var context = Object.create(fixture.contextPrototype)
    context.canvas = canvas
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.contextTypes.get(canvas)).toBe('webgl')
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledOnceWith(
      canvas,
      {
        trigger: 'auto',
        scheduler: 'webgl_snapshot',
        contextType: 'webgl'
      }
    )

    observer.stop()
    expect(fixture.contextPrototype.drawArrays).toBe(originalDrawArrays)
  })

  it('does not snapshot internal or configuration-rejected canvases', async () => {
    var fixture = createObserverOptions({
      hostShouldRecordCanvas: function () {
        return false
      }
    })
    var canvas = document.createElement('canvas')
    var context = Object.create(fixture.contextPrototype)
    context.canvas = canvas
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await Promise.resolve()

    expect(fixture.options.hostSnapshotCanvas).not.toHaveBeenCalled()
    observer.stop()

    fixture = createObserverOptions({
      hostIsInternalCanvas: function () {
        return true
      }
    })
    context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    observer = startCanvasWebGLSnapshotObserver(fixture.options)
    context.drawArrays()
    await Promise.resolve()

    expect(fixture.options.hostSnapshotCanvas).not.toHaveBeenCalled()
    observer.stop()
  })

  it('marks contexts discovered through the patched canvas getContext', () => {
    var fixture = createObserverOptions()
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)
    var canvas = {}

    fixture.canvasPrototype.getContext.call(canvas, 'webgl2')

    expect(fixture.contextTypes.get(canvas)).toBe('webgl2')
    expect(observer.isWebGLCanvas(canvas)).toBeTrue()
    observer.stop()
  })

  it('classifies a WebGL context created during the bootstrap window', () => {
    var fixture = createObserverOptions()
    var canvas = document.createElement('canvas')

    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries: fixture.options.contextPrototypeEntries,
      canvasPrototype: fixture.options.canvasPrototype,
      animationFrameTarget: fixture.options.animationFrameTarget
    })
    fixture.canvasPrototype.getContext.call(canvas, 'webgl')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    expect(fixture.contextTypes.get(canvas)).toBeUndefined()
    expect(observer.isWebGLCanvas(canvas)).toBeTrue()
    observer.stop()
  })

  it('observes extension draw methods without patching extension objects forever', async () => {
    var extensionPrototype = {
      drawArraysInstancedANGLE: function () {}
    }
    var originalDraw = extensionPrototype.drawArraysInstancedANGLE
    var extension = Object.create(extensionPrototype)
    var fixture = createObserverOptions()
    fixture.contextPrototype.getExtension = function () {
      return extension
    }
    var canvas = document.createElement('canvas')
    var context = Object.create(fixture.contextPrototype)
    context.canvas = canvas
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.getExtension('ANGLE_instanced_arrays')
    extension.drawArraysInstancedANGLE()
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalled()
    observer.stop()
    expect(extensionPrototype.drawArraysInstancedANGLE).toBe(originalDraw)
  })

  it('drains draws at the end of the requestAnimationFrame callback', () => {
    var fixture = createObserverOptions({
      animationFrameTarget: {
        requestAnimationFrame: function (callback) {
          callback(10)
          return 1
        }
      }
    })
    var canvas = document.createElement('canvas')
    var context = Object.create(fixture.contextPrototype)
    context.canvas = canvas
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    fixture.options.animationFrameTarget.requestAnimationFrame(function () {
      context.drawArrays()
      expect(fixture.options.hostSnapshotCanvas).not.toHaveBeenCalled()
    })

    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
  })

  it('invalidates a queued draw when the observer is reset', () => {
    var scheduledDrain
    var fixture = createObserverOptions({
      scheduleMicrotask: function (callback) {
        scheduledDrain = callback
      }
    })
    var canvas = document.createElement('canvas')
    var context = Object.create(fixture.contextPrototype)
    context.canvas = canvas
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    observer.reset()
    scheduledDrain()

    expect(fixture.options.hostSnapshotCanvas).not.toHaveBeenCalled()
    observer.stop()
  })

  it('routes a draw cached after bootstrap but before the observer starts', async () => {
    var originalDrawArrays = function () {
      return 'early-draw'
    }
    var sharedPrototype = {
      drawArrays: originalDrawArrays,
      getExtension: function () {}
    }
    var fixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var canvas = document.createElement('canvas')
    var context = Object.create(sharedPrototype)
    context.canvas = canvas

    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries: fixture.options.contextPrototypeEntries,
      canvasPrototype: fixture.options.canvasPrototype,
      animationFrameTarget: fixture.options.animationFrameTarget
    })
    var cachedDrawArrays = context.drawArrays.bind(context)
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    expect(cachedDrawArrays()).toBe('early-draw')
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)

    var restartedFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var restartedObserver = startCanvasWebGLSnapshotObserver(
      restartedFixture.options
    )
    expect(cachedDrawArrays()).toBe('early-draw')
    await Promise.resolve()
    await Promise.resolve()

    expect(
      restartedFixture.options.hostSnapshotCanvas
    ).toHaveBeenCalledTimes(1)
    restartedObserver.stop()
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)
  })

  it('routes an extension draw cached after bootstrap but before the observer starts', async () => {
    var originalExtensionDraw = function () {
      return 'early-extension-draw'
    }
    var extensionPrototype = {
      drawArraysInstancedANGLE: originalExtensionDraw
    }
    var extension = Object.create(extensionPrototype)
    var originalGetExtension = jasmine
      .createSpy('getExtension')
      .and.returnValue(extension)
    var sharedPrototype = {
      drawArrays: function () {},
      getExtension: originalGetExtension
    }
    var fixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')

    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries: fixture.options.contextPrototypeEntries,
      canvasPrototype: fixture.options.canvasPrototype,
      animationFrameTarget: fixture.options.animationFrameTarget
    })
    var cachedExtension = context.getExtension('ANGLE_instanced_arrays')
    var cachedExtensionDraw =
      cachedExtension.drawArraysInstancedANGLE.bind(cachedExtension)
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    expect(cachedExtensionDraw()).toBe('early-extension-draw')
    await Promise.resolve()
    await Promise.resolve()

    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
    expect(sharedPrototype.getExtension).toBe(originalGetExtension)
    expect(extensionPrototype.drawArraysInstancedANGLE).toBe(
      originalExtensionDraw
    )

    var restartedFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var restartedObserver = startCanvasWebGLSnapshotObserver(
      restartedFixture.options
    )
    originalGetExtension.calls.reset()
    expect(cachedExtensionDraw()).toBe('early-extension-draw')
    await Promise.resolve()
    await Promise.resolve()

    expect(originalGetExtension).not.toHaveBeenCalled()
    expect(
      restartedFixture.options.hostSnapshotCanvas
    ).toHaveBeenCalledTimes(1)
    restartedObserver.stop()
    expect(sharedPrototype.getExtension).toBe(originalGetExtension)
    expect(extensionPrototype.drawArraysInstancedANGLE).toBe(
      originalExtensionDraw
    )
  })

  it('uses a requestAnimationFrame cached after bootstrap as the draw boundary', () => {
    var queuedCallback
    var originalRequestAnimationFrame = function (callback) {
      queuedCallback = callback
      return 17
    }
    var animationFrameTarget = {
      requestAnimationFrame: originalRequestAnimationFrame
    }
    var fixture = createObserverOptions({
      animationFrameTarget: animationFrameTarget
    })
    var canvas = document.createElement('canvas')
    var context = Object.create(fixture.contextPrototype)
    context.canvas = canvas

    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries: fixture.options.contextPrototypeEntries,
      canvasPrototype: fixture.options.canvasPrototype,
      animationFrameTarget: animationFrameTarget
    })
    var cachedRequestAnimationFrame =
      animationFrameTarget.requestAnimationFrame
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    expect(
      cachedRequestAnimationFrame.call(animationFrameTarget, function () {
        context.drawArrays()
        expect(
          fixture.options.hostSnapshotCanvas
        ).not.toHaveBeenCalled()
      })
    ).toBe(17)
    queuedCallback(42)

    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
    expect(animationFrameTarget.requestAnimationFrame).toBe(
      originalRequestAnimationFrame
    )
  })

  it('resumes the previous observer when the newest observer stops first', async () => {
    var originalDrawArrays = function () {}
    var sharedPrototype = {
      drawArrays: originalDrawArrays,
      getExtension: function () {}
    }
    var firstFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var secondFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')
    var firstObserver = startCanvasWebGLSnapshotObserver(firstFixture.options)
    var secondObserver = startCanvasWebGLSnapshotObserver(
      secondFixture.options
    )

    context.drawArrays()
    await Promise.resolve()
    await Promise.resolve()
    expect(secondFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    expect(firstFixture.options.hostSnapshotCanvas).not.toHaveBeenCalled()

    secondObserver.stop()
    context.drawArrays()
    await Promise.resolve()
    await Promise.resolve()
    expect(firstFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    expect(sharedPrototype.drawArrays).not.toBe(originalDrawArrays)

    firstObserver.stop()
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)
  })

  it('keeps the newest observer active when an older observer stops first', async () => {
    var originalDrawArrays = function () {}
    var sharedPrototype = {
      drawArrays: originalDrawArrays,
      getExtension: function () {}
    }
    var firstFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var secondFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')
    var firstObserver = startCanvasWebGLSnapshotObserver(firstFixture.options)
    var secondObserver = startCanvasWebGLSnapshotObserver(
      secondFixture.options
    )

    firstObserver.stop()
    context.drawArrays()
    await Promise.resolve()
    await Promise.resolve()

    expect(firstFixture.options.hostSnapshotCanvas).not.toHaveBeenCalled()
    expect(secondFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    expect(sharedPrototype.drawArrays).not.toBe(originalDrawArrays)

    secondObserver.stop()
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)
  })

  it('routes a Cocos-style cached draw method to a restarted observer', async () => {
    var sharedPrototype = {
      drawArrays: function () {
        return 'drawn'
      },
      getExtension: function () {}
    }
    var firstFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var canvas = document.createElement('canvas')
    var context = Object.create(sharedPrototype)
    context.canvas = canvas
    var firstObserver = startCanvasWebGLSnapshotObserver(
      firstFixture.options
    )
    var cachedDrawArrays = context.drawArrays

    expect(cachedDrawArrays.call(context)).toBe('drawn')
    await Promise.resolve()
    await Promise.resolve()
    expect(firstFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    firstObserver.stop()

    var secondFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var secondObserver = startCanvasWebGLSnapshotObserver(
      secondFixture.options
    )

    expect(cachedDrawArrays.call(context)).toBe('drawn')
    await Promise.resolve()
    await Promise.resolve()
    expect(secondFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    expect(firstFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    secondObserver.stop()
  })

  it('routes a cached extension draw after restart without another getExtension call', async () => {
    var extensionPrototype = {
      drawArraysInstancedANGLE: function () {
        return 'extension-draw'
      }
    }
    var extension = Object.create(extensionPrototype)
    var getExtension = jasmine
      .createSpy('getExtension')
      .and.returnValue(extension)
    var sharedPrototype = {
      drawArrays: function () {},
      getExtension: getExtension
    }
    var firstFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')
    var firstObserver = startCanvasWebGLSnapshotObserver(
      firstFixture.options
    )
    context.getExtension('ANGLE_instanced_arrays')
    var cachedExtensionDraw = extension.drawArraysInstancedANGLE
    firstObserver.stop()

    var secondFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var secondObserver = startCanvasWebGLSnapshotObserver(
      secondFixture.options
    )
    getExtension.calls.reset()

    expect(cachedExtensionDraw.call(extension)).toBe('extension-draw')
    await Promise.resolve()
    await Promise.resolve()

    expect(getExtension).not.toHaveBeenCalled()
    expect(secondFixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    secondObserver.stop()
  })

  it('patches a shared inherited draw owner once and restores it on stop', async () => {
    var owner = {
      drawArrays: function () {
        return 'inherited-draw'
      },
      getExtension: function () {}
    }
    var originalDrawArrays = owner.drawArrays
    var firstPrototype = Object.create(owner)
    var secondPrototype = Object.create(owner)
    var fixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: firstPrototype },
        { contextType: 'webgl2', prototype: secondPrototype }
      ]
    })
    var context = Object.create(firstPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    expect(context.drawArrays()).toBe('inherited-draw')
    await Promise.resolve()
    await Promise.resolve()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    observer.stop()
    expect(owner.drawArrays).toBe(originalDrawArrays)
  })

  it('does not overwrite an application extension replacement during stop', () => {
    var extensionPrototype = {
      drawArraysInstancedANGLE: function () {}
    }
    var extension = Object.create(extensionPrototype)
    var fixture = createObserverOptions()
    fixture.contextPrototype.getExtension = function () {
      return extension
    }
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)
    context.getExtension('ANGLE_instanced_arrays')
    var applicationReplacement = function () {
      return 'replacement'
    }
    extensionPrototype.drawArraysInstancedANGLE = applicationReplacement

    observer.stop()

    expect(extensionPrototype.drawArraysInstancedANGLE).toBe(
      applicationReplacement
    )
  })

  it('keeps a cached requestAnimationFrame wrapper transparent after stop', () => {
    var animationFrameTarget = {
      requestAnimationFrame: jasmine
        .createSpy('requestAnimationFrame')
        .and.callFake(function (callback) {
          callback(42)
          return 7
        })
    }
    var fixture = createObserverOptions({
      animationFrameTarget: animationFrameTarget
    })
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)
    var cachedRequestAnimationFrame =
      animationFrameTarget.requestAnimationFrame
    var callback = jasmine.createSpy('callback')

    observer.stop()

    expect(
      cachedRequestAnimationFrame.call(animationFrameTarget, callback)
    ).toBe(7)
    expect(callback).toHaveBeenCalledOnceWith(42)
  })

  it('keeps a cooldown draw dirty until another business draw', async () => {
    var timers = createTimerHarness()
    var fixture = createObserverOptions({
      now: timers.now,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl
    })
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    context.drawArrays()
    await flushMicrotasks()
    timers.advanceBy(49)
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    timers.advanceBy(1)
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    observer.stop()
  })

  it('enforces the private WebGL interval instead of the faster 2d default', async () => {
    var timers = createTimerHarness()
    var fixture = createObserverOptions({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 20,
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoCooldown: 1000,
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      },
      now: timers.now,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl
    })
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    timers.advanceBy(999)
    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    timers.advanceBy(1)
    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    observer.stop()
  })

  it('does not stage an in-flight draw from encode completion', async () => {
    var timers = createTimerHarness()
    var resolveFirstSnapshot
    var snapshotCallCount = 0
    var fixture = createObserverOptions({
      now: timers.now,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      hostSnapshotCanvas: jasmine
        .createSpy('hostSnapshotCanvas')
        .and.callFake(function () {
          snapshotCallCount += 1
          if (snapshotCallCount === 1) {
            return new Promise(function (resolve) {
              resolveFirstSnapshot = resolve
            })
          }
          return Promise.resolve({ ok: true })
        })
    })
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await flushMicrotasks()
    context.drawArrays()
    resolveFirstSnapshot({ ok: true })
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    timers.advanceBy(50)
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    observer.stop()
  })

  it('does not stage a waiting canvas from another encode completion', async () => {
    var resolveFirstSnapshot
    var fixture = createObserverOptions({
      hostSnapshotCanvas: jasmine
        .createSpy('hostSnapshotCanvas')
        .and.callFake(function () {
          if (!resolveFirstSnapshot) {
            return new Promise(function (resolve) {
              resolveFirstSnapshot = resolve
            })
          }
          return Promise.resolve({ ok: true })
        })
    })
    var firstContext = Object.create(fixture.contextPrototype)
    firstContext.canvas = document.createElement('canvas')
    var secondContext = Object.create(fixture.contextPrototype)
    secondContext.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    firstContext.drawArrays()
    await flushMicrotasks()
    secondContext.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    resolveFirstSnapshot({ ok: true })
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    secondContext.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    expect(
      fixture.options.hostSnapshotCanvas.calls.argsFor(1)[0]
    ).toBe(secondContext.canvas)
    observer.stop()
  })

  it('drops boundary candidates after queue pressure and waits for a fresh draw', async () => {
    var fixture = createObserverOptions()
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)
    var contexts = []

    for (var contextIndex = 0; contextIndex < 64; contextIndex += 1) {
      var context = Object.create(fixture.contextPrototype)
      context.canvas = document.createElement('canvas')
      contexts.push(context)
      context.drawArrays()
    }

    await flushMicrotasks(100)
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    await flushMicrotasks(100)
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    contexts[63].drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    expect(
      fixture.options.hostSnapshotCanvas.calls.argsFor(1)[0]
    ).toBe(contexts[63].canvas)
    observer.stop()
  })

  it('rotates equal-priority canvases fairly across draw boundaries', async () => {
    var timers = createTimerHarness()
    var animationFrameCallback
    var fixture = createObserverOptions({
      now: timers.now,
      animationFrameTarget: {
        requestAnimationFrame: function (callback) {
          animationFrameCallback = callback
          return 1
        }
      },
      hostGetSerializedNodeId: function (canvas) {
        return canvas.$rTestId
      }
    })
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)
    var firstContext = Object.create(fixture.contextPrototype)
    firstContext.canvas = document.createElement('canvas')
    firstContext.canvas.$rTestId = 'first'
    var secondContext = Object.create(fixture.contextPrototype)
    secondContext.canvas = document.createElement('canvas')
    secondContext.canvas.$rTestId = 'second'

    fixture.options.animationFrameTarget.requestAnimationFrame(function () {
      firstContext.drawArrays()
      secondContext.drawArrays()
    })
    animationFrameCallback(1)
    await flushMicrotasks()
    expect(
      fixture.options.hostSnapshotCanvas.calls.first().args[0]
    ).toBe(firstContext.canvas)

    timers.advanceBy(50)
    fixture.options.animationFrameTarget.requestAnimationFrame(function () {
      firstContext.drawArrays()
      secondContext.drawArrays()
    })
    animationFrameCallback(2)
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    expect(
      fixture.options.hostSnapshotCanvas.calls.argsFor(1)[0]
    ).toBe(secondContext.canvas)
    observer.stop()
  })

  it('re-evaluates the host recording decision for every scheduling attempt', async () => {
    var timers = createTimerHarness()
    var shouldRecord = true
    var hostShouldRecordCanvas = jasmine
      .createSpy('hostShouldRecordCanvas')
      .and.callFake(function () {
        return shouldRecord
      })
    var fixture = createObserverOptions({
      now: timers.now,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      hostShouldRecordCanvas: hostShouldRecordCanvas
    })
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    shouldRecord = false
    timers.advanceBy(50)
    context.drawArrays()
    await flushMicrotasks()

    expect(hostShouldRecordCanvas).toHaveBeenCalledTimes(3)
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
  })

  it('keeps the recording decision callback bounded during dense draws', async () => {
    var timers = createTimerHarness()
    var resolveSnapshot
    var hostShouldRecordCanvas = jasmine
      .createSpy('hostShouldRecordCanvas')
      .and.returnValue(true)
    var fixture = createObserverOptions({
      now: timers.now,
      hostShouldRecordCanvas: hostShouldRecordCanvas,
      hostSnapshotCanvas: jasmine
        .createSpy('hostSnapshotCanvas')
        .and.callFake(function () {
          return new Promise(function (resolve) {
            resolveSnapshot = resolve
          })
        })
    })
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    for (var drawIndex = 0; drawIndex < 1000; drawIndex += 1) {
      context.drawArrays()
    }
    await flushMicrotasks()
    for (drawIndex = 0; drawIndex < 1000; drawIndex += 1) {
      context.drawArrays()
    }

    resolveSnapshot({ ok: true })
    await flushMicrotasks()
    for (drawIndex = 0; drawIndex < 1000; drawIndex += 1) {
      context.drawArrays()
    }

    // Once when the boundary candidate is queued and once immediately before
    // capture. Draws coalesced behind the queued, in-flight, or cooldown state
    // must not invoke arbitrary customer code on the WebGL hot path.
    expect(hostShouldRecordCanvas).toHaveBeenCalledTimes(2)
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
  })

  it('cancels a deferred visible tail when the page becomes hidden', async () => {
    var timers = createTimerHarness()
    var visibilityState = 'visible'
    var onVisibilityChange
    var fixture = createObserverOptions({
      now: timers.now,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl,
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, callback) {
        onVisibilityChange = callback
        return { stop: function () {} }
      }
    })
    var context = Object.create(fixture.contextPrototype)
    context.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    context.drawArrays()
    await flushMicrotasks()
    context.drawArrays()
    visibilityState = 'hidden'
    onVisibilityChange()
    timers.advanceBy(50)
    await flushMicrotasks()

    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
  })

  it('wakes visible work after a previous-generation snapshot settles', async () => {
    var visibilityState = 'visible'
    var onVisibilityChange
    var resolveFirstSnapshot
    var fixture = createObserverOptions({
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, callback) {
        onVisibilityChange = callback
        return { stop: function () {} }
      },
      hostSnapshotCanvas: jasmine
        .createSpy('hostSnapshotCanvas')
        .and.callFake(function () {
          if (!resolveFirstSnapshot) {
            return new Promise(function (resolve) {
              resolveFirstSnapshot = resolve
            })
          }
          return Promise.resolve({ ok: true })
        })
    })
    var firstContext = Object.create(fixture.contextPrototype)
    firstContext.canvas = document.createElement('canvas')
    var nextContext = Object.create(fixture.contextPrototype)
    nextContext.canvas = document.createElement('canvas')
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    firstContext.drawArrays()
    await flushMicrotasks()
    visibilityState = 'hidden'
    onVisibilityChange()
    visibilityState = 'visible'
    nextContext.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    resolveFirstSnapshot({ ok: true })
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)

    nextContext.drawArrays()
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(2)
    expect(
      fixture.options.hostSnapshotCanvas.calls.argsFor(1)[0]
    ).toBe(nextContext.canvas)
    observer.stop()
  })

  it('selects numeric host priorities first and reports them in debug results', async () => {
    var fixture = createObserverOptions({
      hostShouldRecordCanvas: function (canvas) {
        return canvas.$rTestPriority
      },
      hostGetSerializedNodeId: function (canvas) {
        return canvas.$rTestId
      }
    })
    var lowPriorityContext = Object.create(fixture.contextPrototype)
    lowPriorityContext.canvas = document.createElement('canvas')
    lowPriorityContext.canvas.$rTestId = 'low'
    lowPriorityContext.canvas.$rTestPriority = 1
    var highPriorityContext = Object.create(fixture.contextPrototype)
    highPriorityContext.canvas = document.createElement('canvas')
    highPriorityContext.canvas.$rTestId = 'high'
    highPriorityContext.canvas.$rTestPriority = 9
    var observer = startCanvasWebGLSnapshotObserver(fixture.options)

    lowPriorityContext.drawArrays()
    highPriorityContext.drawArrays()
    await flushMicrotasks(40)

    expect(
      fixture.options.hostSnapshotCanvas.calls.first().args[0]
    ).toBe(highPriorityContext.canvas)
    var highPriorityDebugEvent = fixture.options.hostOnDebug.calls
      .allArgs()
      .map(function (args) {
        return args[0]
      })
      .find(function (debugEvent) {
        return debugEvent.results[0].canvasId === 'high'
      })
    expect(highPriorityDebugEvent.results[0].priority).toBe(9)
    observer.stop()
  })

  it('expires an unclaimed bootstrap lease while cached wrappers remain reusable', async () => {
    var timers = createTimerHarness()
    var originalDrawArrays = function () {
      return 'leased-draw'
    }
    var sharedPrototype = {
      drawArrays: originalDrawArrays,
      getExtension: function () {}
    }
    var fixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    var context = Object.create(sharedPrototype)
    context.canvas = document.createElement('canvas')

    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries: fixture.options.contextPrototypeEntries,
      canvasPrototype: fixture.options.canvasPrototype,
      animationFrameTarget: fixture.options.animationFrameTarget,
      bootstrapLeaseDuration: 30,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl
    })
    var cachedDrawArrays = context.drawArrays
    expect(sharedPrototype.drawArrays).not.toBe(originalDrawArrays)

    timers.advanceBy(30)
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)

    var observer = startCanvasWebGLSnapshotObserver(fixture.options)
    expect(cachedDrawArrays.call(context)).toBe('leased-draw')
    await flushMicrotasks()
    expect(fixture.options.hostSnapshotCanvas).toHaveBeenCalledTimes(1)
    observer.stop()
  })

  it('releases bootstrap patches when recording is disabled or initialization fails', () => {
    var timers = createTimerHarness()
    var originalDrawArrays = function () {}
    var sharedPrototype = {
      drawArrays: originalDrawArrays,
      getExtension: function () {}
    }
    var disabledFixture = createObserverOptions({
      configuration: {
        replayCanvasEnabled: false,
        replayCanvasMode: 'auto'
      },
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries:
        disabledFixture.options.contextPrototypeEntries,
      canvasPrototype: disabledFixture.options.canvasPrototype,
      animationFrameTarget: disabledFixture.options.animationFrameTarget,
      bootstrapLeaseDuration: 30,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl
    })
    startCanvasWebGLSnapshotObserver(disabledFixture.options)
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)

    var failingFixture = createObserverOptions({
      contextPrototypeEntries: [
        { contextType: 'webgl', prototype: sharedPrototype }
      ]
    })
    delete failingFixture.options.hostGetCanvasContextType
    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries:
        failingFixture.options.contextPrototypeEntries,
      canvasPrototype: failingFixture.options.canvasPrototype,
      animationFrameTarget: failingFixture.options.animationFrameTarget,
      bootstrapLeaseDuration: 30,
      setTimeoutImpl: timers.setTimeoutImpl,
      clearTimeoutImpl: timers.clearTimeoutImpl
    })
    expect(function () {
      startCanvasWebGLSnapshotObserver(failingFixture.options)
    }).toThrowError(
      Error,
      'WebGL replay observer requires hostGetCanvasContextType'
    )
    expect(sharedPrototype.drawArrays).not.toBe(originalDrawArrays)

    timers.advanceBy(30)
    expect(sharedPrototype.drawArrays).toBe(originalDrawArrays)
  })

  it('requires the base-owned context and recording hooks', () => {
    var fixture = createObserverOptions()
    delete fixture.options.hostGetCanvasContextType

    expect(function () {
      startCanvasWebGLSnapshotObserver(fixture.options)
    }).toThrowError(
      Error,
      'WebGL replay observer requires hostGetCanvasContextType'
    )
  })
})
