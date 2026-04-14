import { startContinuousCanvasSnapshotLoop } from './canvasContinuousScheduler'

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

    startContinuousCanvasSnapshotLoop({
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

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(secondFrameCallback).toBeUndefined()

    releaseSnapshot({ ok: true })
    await snapshotDone
    await flushContinuousLoop()

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

  it('should not snapshot the same canvas again before the minimum success interval', async () => {
    var nowTime = 0
    var frameCallbacks = []
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var onDebug = jasmine.createSpy('onDebug')

    startContinuousCanvasSnapshotLoop({
      configuration: createConfiguration(),
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    nowTime = 50
    frameCallbacks.shift()()
    await flushContinuousLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(onDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scheduler: 'continuous_snapshot',
        status: 'skipped_no_candidates',
        selectedCanvasCount: 0
      })
    )

    nowTime = 140
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

  it("should return an inert controller when command capture sampling is enabled", () => {
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

    expect(requestAnimationFrameImpl).not.toHaveBeenCalled()
    expect(loop).toEqual(
      jasmine.objectContaining({
        stop: jasmine.any(Function),
        reset: jasmine.any(Function)
      })
    )
  })
})
