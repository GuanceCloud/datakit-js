import { startContinuousCanvasSnapshotLoop } from './canvasContinuousScheduler'
import { setReplayCanvasContextType } from './canvasContext'

describe('replay/record/canvasContinuousScheduler', () => {
  async function flushContinuousLoop() {
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
  }

  function createConfiguration(overrides) {
    return Object.assign(
      {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 2
      },
      overrides
    )
  }

  it('should snapshot canvases on animation frames when experimental continuous mode is enabled', async () => {
    var recordedFrameCallback
    var requestAnimationFrameImpl = jasmine
      .createSpy('requestAnimationFrame')
      .and.callFake(function (callback) {
        recordedFrameCallback = callback
        return 123
      })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(1)

    recordedFrameCallback()
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    loop.stop()
  })

  it('should snapshot multiple canvases sequentially within a frame', async () => {
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var calls = []
    var releaseFirst
    var firstSnapshotDone = new Promise(function (resolve) {
      releaseFirst = resolve
    })
    var recordedFrameCallback
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function (canvas) {
        calls.push(canvas)
        if (canvas === firstCanvas) {
          return firstSnapshotDone
        }
        return Promise.resolve({ ok: true })
      })

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [firstCanvas, secondCanvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 123
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    recordedFrameCallback()
    await Promise.resolve()

    expect(snapshotCanvas.calls.count()).toBe(1)
    expect(calls).toEqual([firstCanvas])

    releaseFirst({ ok: true })
    await firstSnapshotDone
    await flushContinuousLoop()

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(calls).toEqual([firstCanvas, secondCanvas])
  })

  it('should avoid overlapping continuous snapshot runs', async () => {
    var nowTime = 0
    var firstFrameCallback
    var secondFrameCallback
    var scheduledTimeoutCallback
    var frameCount = 0
    var releaseSnapshot
    var snapshotDone = new Promise(function (resolve) {
      releaseSnapshot = resolve
    })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(snapshotDone)

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCount += 1
        if (frameCount === 1) {
          firstFrameCallback = callback
        } else {
          secondFrameCallback = callback
        }
        return frameCount
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback) {
        scheduledTimeoutCallback = callback
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    firstFrameCallback()
    await Promise.resolve()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(secondFrameCallback).toBeUndefined()

    releaseSnapshot({ ok: true })
    await snapshotDone
    await flushContinuousLoop()

    expect(secondFrameCallback).toBeUndefined()
    expect(scheduledTimeoutCallback).toEqual(jasmine.any(Function))

    nowTime = 250
    scheduledTimeoutCallback()
    expect(secondFrameCallback).toEqual(jasmine.any(Function))
  })

  it('should cancel the scheduled animation frame on stop', () => {
    var cancelAnimationFrameImpl = jasmine.createSpy('cancelAnimationFrame')
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return []
      },
      snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
      requestAnimationFrameImpl: function () {
        return 789
      },
      cancelAnimationFrameImpl: cancelAnimationFrameImpl
    })

    loop.stop()

    expect(cancelAnimationFrameImpl).toHaveBeenCalledWith(789)
  })

  it('should listen for visibility changes on document', () => {
    var addEventListenerImpl = jasmine
      .createSpy('addEventListener')
      .and.returnValue({ stop: jasmine.createSpy('stop') })
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return []
      },
      snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
      addEventListenerImpl: addEventListenerImpl,
      requestAnimationFrameImpl: jasmine
        .createSpy('requestAnimationFrame')
        .and.returnValue(123),
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    expect(addEventListenerImpl).toHaveBeenCalledWith(
      document,
      'visibilitychange',
      jasmine.any(Function),
      { capture: true }
    )

    loop.stop()
  })

  it('should skip hidden frames and resume when visible again', async () => {
    var visibilityState = 'hidden'
    var visibilityHandler
    var recordedFrameCallback
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var onDebug = jasmine.createSpy('onDebug')

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, handler) {
        visibilityHandler = handler
        return { stop: jasmine.createSpy('stop') }
      },
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 123
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    expect(recordedFrameCallback).toBeUndefined()

    visibilityState = 'visible'
    visibilityHandler()
    expect(recordedFrameCallback).toEqual(jasmine.any(Function))

    recordedFrameCallback()
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(onDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scheduler: 'continuous_snapshot',
        status: 'completed',
        selectedCanvasCount: 1
      })
    )
  })

  it('should not schedule or snapshot while hidden even after reset until visibility resumes', async () => {
    var visibilityState = 'hidden'
    var visibilityHandler
    var requestAnimationFrameImpl = jasmine.createSpy('requestAnimationFrame')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, handler) {
        visibilityHandler = handler
        return { stop: jasmine.createSpy('stop') }
      },
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    expect(requestAnimationFrameImpl).not.toHaveBeenCalled()

    loop.reset()
    expect(requestAnimationFrameImpl).not.toHaveBeenCalled()
    expect(snapshotCanvas).not.toHaveBeenCalled()

    visibilityHandler()
    expect(requestAnimationFrameImpl).not.toHaveBeenCalled()
    expect(snapshotCanvas).not.toHaveBeenCalled()

    visibilityState = 'visible'
    visibilityHandler()
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(1)

    loop.stop()
  })

  it('should only schedule one resumed frame when visibility toggles back to visible repeatedly', () => {
    var visibilityState = 'hidden'
    var visibilityHandler
    var requestAnimationFrameImpl = jasmine
      .createSpy('requestAnimationFrame')
      .and.returnValue(123)

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(Promise.resolve({ ok: true })),
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, handler) {
        visibilityHandler = handler
        return { stop: jasmine.createSpy('stop') }
      },
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    visibilityState = 'visible'
    visibilityHandler()
    visibilityHandler()
    visibilityHandler()

    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(1)

    loop.stop()
  })

  it('should reset pending work and schedule an immediate rerun', async () => {
    var firstFrameCallback
    var secondFrameCallback
    var frameCount = 0
    var releaseSnapshot
    var snapshotDone = new Promise(function (resolve) {
      releaseSnapshot = resolve
    })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(snapshotDone)

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCount += 1
        if (frameCount === 1) {
          firstFrameCallback = callback
        } else {
          secondFrameCallback = callback
        }
        return frameCount
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    firstFrameCallback()
    await Promise.resolve()
    loop.reset()

    releaseSnapshot({ ok: true })
    await snapshotDone
    await flushContinuousLoop()

    expect(secondFrameCallback).toEqual(jasmine.any(Function))
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
  })

  it('should discard an in-flight hidden run and schedule a resumed frame when visible again', async () => {
    var visibilityState = 'visible'
    var visibilityHandler
    var firstFrameCallback
    var secondFrameCallback
    var frameCount = 0
    var releaseSnapshot
    var snapshotDone = new Promise(function (resolve) {
      releaseSnapshot = resolve
    })
    var onDebug = jasmine.createSpy('onDebug')

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: jasmine.createSpy('snapshotCanvas').and.returnValue(snapshotDone),
      onDebug: onDebug,
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, handler) {
        visibilityHandler = handler
        return { stop: jasmine.createSpy('stop') }
      },
      requestAnimationFrameImpl: function (callback) {
        frameCount += 1
        if (frameCount === 1) {
          firstFrameCallback = callback
        } else {
          secondFrameCallback = callback
        }
        return frameCount
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    firstFrameCallback()
    await Promise.resolve()

    visibilityState = 'hidden'
    visibilityHandler()

    visibilityState = 'visible'
    visibilityHandler()

    releaseSnapshot({ ok: true })
    await snapshotDone
    await flushContinuousLoop()

    expect(onDebug).not.toHaveBeenCalledWith(
      jasmine.objectContaining({
        scheduler: 'continuous_snapshot',
        status: 'completed'
      })
    )
    expect(secondFrameCallback).toEqual(jasmine.any(Function))
  })

  it('should use the per-canvas target interval for successful snapshots', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var scheduledTimeout
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    expect(scheduledTimeout.delay).toBe(250)
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    nowTime = 250
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
  })

  it('should keep probing an unchanged canvas at the target cadence', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var scheduledTimeout
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(
        Promise.resolve({ ok: false, reason: 'below_threshold' })
      )

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 250,
        replayCanvasAutoCooldown: 250,
        replayCanvasAutoUnchangedBackoff: 3000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    // Unchanged backoff limits full validation in canvasObserver.  It must not
    // stop this lightweight signature probe from seeing a later changed frame.
    expect(scheduledTimeout.delay).toBe(250)

    nowTime = 250
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
  })

  it('should progressively back off static probes and reset after a change', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var scheduledTimeout
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValues(
        Promise.resolve({ ok: false, reason: 'below_threshold' }),
        Promise.resolve({ ok: false, reason: 'below_threshold' }),
        Promise.resolve({ ok: true }),
        Promise.resolve({ ok: true })
      )

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 250,
        replayCanvasAutoCooldown: 250,
        replayCanvasAutoUnchangedBackoff: 3000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(scheduledTimeout.delay).toBe(250)

    nowTime = 250
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(scheduledTimeout.delay).toBe(500)

    nowTime = 750
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(3)
    expect(scheduledTimeout.delay).toBe(250)

    nowTime = 1000
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(4)
  })

  it('should fairly spread ten canvases across the global throughput budget', async () => {
    var nowTime = 0
    var canvases = []
    for (var canvasIndex = 0; canvasIndex < 10; canvasIndex += 1) {
      canvases.push(document.createElement('canvas'))
    }
    var frameCallbacks = []
    var scheduledTimeout
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 250,
        replayCanvasAutoCooldown: 250,
        replayCanvasAutoMaxPerRun: 2,
        replayCanvasMaxConcurrentEncodes: 1
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return canvases
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    async function runNextBatch(at) {
      expect(scheduledTimeout.delay).toBe(120)
      nowTime = at
      scheduledTimeout.callback()
      frameCallbacks.shift()()
      await flushContinuousLoop()
    }

    frameCallbacks.shift()()
    await flushContinuousLoop()
    await runNextBatch(120)
    await runNextBatch(240)
    await runNextBatch(360)
    await runNextBatch(480)

    expect(snapshotCanvas.calls.allArgs()).toEqual(
      canvases.map(function (canvas) {
        return [canvas]
      })
    )

    // The next fair round starts after 600 ms instead of waiting for five
    // one-second global scans, while the aggregate rate remains bounded.
    await runNextBatch(600)
    expect(snapshotCanvas.calls.argsFor(10)).toEqual([canvases[0]])
    expect(snapshotCanvas.calls.argsFor(11)).toEqual([canvases[1]])
    loop.stop()
  })

  it('should let cooldown override a faster per-canvas target interval', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var scheduledTimeout
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 125,
        replayCanvasAutoCooldown: 500
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(scheduledTimeout.delay).toBe(500)
  })

  it('should measure cooldown and failure backoff from encode completion', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var scheduledTimeout
    var resolveSnapshot
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(
        new Promise(function (resolve) {
          resolveSnapshot = resolve
        })
      )

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 250,
        replayCanvasAutoCooldown: 250,
        replayCanvasAutoFailureBackoff: 1000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await Promise.resolve()
    nowTime = 200
    resolveSnapshot({ ok: true })
    await flushContinuousLoop()
    expect(scheduledTimeout.delay).toBe(250)

    nowTime = 450
    var resolveFailedSnapshot
    snapshotCanvas.and.returnValue(
      new Promise(function (resolve) {
        resolveFailedSnapshot = resolve
      })
    )
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await Promise.resolve()
    nowTime = 650
    resolveFailedSnapshot({ ok: false, reason: 'record_rejected' })
    await flushContinuousLoop()
    // Discovery is still bounded from the run start, but the canvas itself
    // cannot become eligible until 1,000 ms after the failed encode completed.
    expect(scheduledTimeout.delay).toBe(300)
    nowTime = 1150
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    expect(scheduledTimeout.delay).toBe(500)
  })

  it('should retain failure backoff when replay admission is backpressured', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var scheduledTimeout
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(
        Promise.resolve({ ok: false, reason: 'record_rejected' })
      )

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 250,
        replayCanvasAutoCooldown: 250,
        replayCanvasAutoFailureBackoff: 1000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        scheduledTimeout = { callback: callback, delay: delay }
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(scheduledTimeout.delay).toBe(500)

    nowTime = 500
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(scheduledTimeout.delay).toBe(500)

    nowTime = 1000
    scheduledTimeout.callback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
  })

  it('should allow an immediate resumed frame after visibility was hidden', async () => {
    var nowTime = 0
    var visibilityState = 'visible'
    var visibilityHandler
    var frameCallbacks = []
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, handler) {
        visibilityHandler = handler
        return { stop: jasmine.createSpy('stop') }
      },
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    nowTime = 60
    visibilityState = 'hidden'
    visibilityHandler()
    visibilityState = 'visible'
    visibilityHandler()
    frameCallbacks.shift()()
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
  })

  it('should bound discovery scans while preserving the per-canvas deadline', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var timeoutCallback
    var canvas = document.createElement('canvas')
    var getCanvases = jasmine
      .createSpy('getCanvases')
      .and.returnValue([canvas])
    var requestAnimationFrameImpl = jasmine
      .createSpy('requestAnimationFrame')
      .and.callFake(function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    var setTimeoutImpl = jasmine
      .createSpy('setTimeout')
      .and.callFake(function (callback) {
        timeoutCallback = callback
        return 91
      })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoCooldown: 1000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: getCanvases,
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: setTimeoutImpl,
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(getCanvases).toHaveBeenCalledTimes(1)
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(1)
    expect(setTimeoutImpl).toHaveBeenCalledWith(jasmine.any(Function), 500)

    nowTime = 500
    timeoutCallback()
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(2)

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(getCanvases).toHaveBeenCalledTimes(2)
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(setTimeoutImpl).toHaveBeenCalledWith(jasmine.any(Function), 500)

    nowTime = 1000
    timeoutCallback()
    frameCallbacks.shift()()
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)

    loop.stop()
  })

  it('should clear a pending scan deadline timer when stopped', async () => {
    var nowTime = 0
    var frameCallback
    var timeoutCallback
    var requestAnimationFrameImpl = jasmine
      .createSpy('requestAnimationFrame')
      .and.callFake(function (callback) {
        frameCallback = callback
        return 1
      })
    var clearTimeoutImpl = jasmine.createSpy('clearTimeout')
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 1000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(Promise.resolve({ ok: true })),
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback) {
        timeoutCallback = callback
        return 92
      },
      clearTimeoutImpl: clearTimeoutImpl
    })

    frameCallback()
    await flushContinuousLoop()
    loop.stop()

    expect(clearTimeoutImpl).toHaveBeenCalledWith(92)

    nowTime = 1000
    timeoutCallback()
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(1)
  })

  it('should clear a pending scan deadline and run immediately after reset', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var timeoutCallback
    var clearTimeoutImpl = jasmine.createSpy('clearTimeout')
    var requestAnimationFrameImpl = jasmine
      .createSpy('requestAnimationFrame')
      .and.callFake(function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 1000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(Promise.resolve({ ok: true })),
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback) {
        timeoutCallback = callback
        return 93
      },
      clearTimeoutImpl: clearTimeoutImpl
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    loop.reset()

    expect(clearTimeoutImpl).toHaveBeenCalledWith(93)
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(2)

    timeoutCallback()
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(2)

    loop.stop()
  })

  it('should clear a pending scan deadline while hidden and resume immediately', async () => {
    var nowTime = 0
    var visibilityState = 'visible'
    var visibilityHandler
    var frameCallbacks = []
    var clearTimeoutImpl = jasmine.createSpy('clearTimeout')
    var requestAnimationFrameImpl = jasmine
      .createSpy('requestAnimationFrame')
      .and.callFake(function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      })
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 1000
      }),
      now: function () {
        return nowTime
      },
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: function (_, __, handler) {
        visibilityHandler = handler
        return { stop: jasmine.createSpy('stop') }
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: jasmine
        .createSpy('snapshotCanvas')
        .and.returnValue(Promise.resolve({ ok: true })),
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function () {
        return 94
      },
      clearTimeoutImpl: clearTimeoutImpl
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()

    visibilityState = 'hidden'
    visibilityHandler()
    expect(clearTimeoutImpl).toHaveBeenCalledWith(94)

    visibilityState = 'visible'
    visibilityHandler()
    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(2)

    loop.stop()
  })

  it('should prefer priority without starving an eligible lower-priority canvas', async () => {
    var lowPriorityCanvas = document.createElement('canvas')
    var highPriorityCanvas = document.createElement('canvas')
    var mediumPriorityCanvas = document.createElement('canvas')
    var nowTime = 100
    var frameCallbacks = []
    var timeoutCallback
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 1,
        replayCanvasAutoCooldown: 1,
        replayCanvasAutoMaxPerRun: 1,
        shouldRecordCanvas: function (canvas) {
          if (canvas === highPriorityCanvas) {
            return 10
          }
          return canvas === mediumPriorityCanvas ? 5 : 0
        }
      }),
      getCanvases: function () {
        return [
          lowPriorityCanvas,
          highPriorityCanvas,
          mediumPriorityCanvas
        ]
      },
      now: function () {
        return nowTime
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback) {
        timeoutCallback = callback
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    nowTime = 160
    timeoutCallback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    nowTime = 220
    timeoutCallback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    nowTime = 280
    timeoutCallback()
    frameCallbacks.shift()()
    await flushContinuousLoop()

    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [highPriorityCanvas],
      [mediumPriorityCanvas],
      [lowPriorityCanvas],
      [highPriorityCanvas]
    ])
    loop.stop()
  })

  it('should not starve changed canvases behind repeatedly unchanged canvases', async () => {
    var canvases = [
      document.createElement('canvas'),
      document.createElement('canvas'),
      document.createElement('canvas')
    ]
    var nowTime = 100
    var frameCallbacks = []
    var timeoutCallback
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: false, reason: 'unchanged' }))
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoInterval: 1,
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasAutoUnchangedBackoff: 2000
      }),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return canvases
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback) {
        timeoutCallback = callback
        return 91
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    nowTime = 160
    timeoutCallback()
    frameCallbacks.shift()()
    await flushContinuousLoop()
    nowTime = 220
    timeoutCallback()
    frameCallbacks.shift()()
    await flushContinuousLoop()

    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [canvases[0]],
      [canvases[1]],
      [canvases[2]]
    ])
    loop.stop()
  })

  it('should fail closed when shouldRecordCanvas throws without stopping the run', async () => {
    var rejectedCanvas = document.createElement('canvas')
    var acceptedCanvas = document.createElement('canvas')
    var frameCallback
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        shouldRecordCanvas: function (canvas) {
          if (canvas === rejectedCanvas) {
            throw new Error('customer hook failed')
          }
          return 1
        }
      }),
      getCanvases: function () {
        return [rejectedCanvas, acceptedCanvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallback = callback
        return 1
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    expect(function () {
      frameCallback()
    }).not.toThrow()
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledOnceWith(acceptedCanvas)
    loop.stop()
  })

  it('should clamp extreme per-run, concurrency, and scan configuration', async () => {
    var canvases = []
    for (var canvasIndex = 0; canvasIndex < 100; canvasIndex += 1) {
      canvases.push(document.createElement('canvas'))
    }
    var frameCallback
    var snapshotResolvers = []
    var shouldRecordCanvas = jasmine
      .createSpy('shouldRecordCanvas')
      .and.returnValue(0)
    var getCanvases = jasmine
      .createSpy('getCanvases')
      .and.returnValue(canvases)
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      })
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasAutoMaxPerRun: Number.MAX_SAFE_INTEGER,
        replayCanvasMaxConcurrentEncodes: Number.MAX_SAFE_INTEGER,
        shouldRecordCanvas: shouldRecordCanvas
      }),
      getCanvases: getCanvases,
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallback = callback
        return 1
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    frameCallback()
    await Promise.resolve()
    await Promise.resolve()

    expect(getCanvases).toHaveBeenCalledOnceWith(64)
    expect(shouldRecordCanvas).toHaveBeenCalledTimes(64)
    expect(snapshotCanvas).toHaveBeenCalledTimes(4)

    snapshotResolvers.slice(0, 4).forEach(function (resolve) {
      resolve({ ok: true })
    })
    await flushContinuousLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(8)
    loop.stop()
    snapshotResolvers.slice(4).forEach(function (resolve) {
      resolve({ ok: true })
    })
    await flushContinuousLoop()
  })

  it('should ignore an in-flight snapshot summary after stop', async () => {
    var frameCallback
    var resolveSnapshot
    var onDebug = jasmine.createSpy('onDebug')
    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: function () {
        return new Promise(function (resolve) {
          resolveSnapshot = resolve
        })
      },
      onDebug: onDebug,
      requestAnimationFrameImpl: function (callback) {
        frameCallback = callback
        return 1
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    frameCallback()
    await Promise.resolve()
    await Promise.resolve()
    loop.stop()
    resolveSnapshot({ ok: true })
    await flushContinuousLoop()

    expect(onDebug).not.toHaveBeenCalled()
  })

  it('should leave WebGL canvases to the draw-driven snapshot observer', async () => {
    var canvas = document.createElement('canvas')
    var frameCallback
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas')
    setReplayCanvasContextType(canvas, 'webgl')

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        frameCallback = callback
        return 1
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    frameCallback()
    await flushContinuousLoop()

    expect(snapshotCanvas).not.toHaveBeenCalled()
  })

  it("should start for foreign-realm fallbacks when command capture sampling is enabled", () => {
    var requestAnimationFrameImpl = jasmine.createSpy('requestAnimationFrame')

    var loop = startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration({
        replayCanvasSampling: 'all'
      }),
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
      requestAnimationFrameImpl: requestAnimationFrameImpl,
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    expect(requestAnimationFrameImpl).toHaveBeenCalledTimes(1)
    expect(loop).toEqual(
      jasmine.objectContaining({
        stop: jasmine.any(Function),
        reset: jasmine.any(Function)
      })
    )
  })
})
