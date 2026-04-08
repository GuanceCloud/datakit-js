import {
  createAutoCanvasSnapshotController,
  startAutoCanvasSnapshotLoop,
  takeAutoCanvasSnapshots
} from './canvasAutoSnapshot'

describe('replay/record/canvasAutoSnapshot', () => {
  async function flushAutoSnapshotLoop() {
    await new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
  }

  it('should snapshot canvases sequentially', async () => {
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var calls = []
    var releaseFirst
    var firstSnapshotDone = new Promise(function (resolve) {
      releaseFirst = resolve
    })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function (canvas) {
        calls.push(canvas)
        if (canvas === firstCanvas) {
          return firstSnapshotDone
        }
        return Promise.resolve()
      })

    var runSnapshots = takeAutoCanvasSnapshots(
      function () {
        return [firstCanvas, secondCanvas]
      },
      snapshotCanvas
    )

    await Promise.resolve()

    expect(snapshotCanvas.calls.count()).toBe(1)
    expect(calls).toEqual([firstCanvas])

    releaseFirst()
    await runSnapshots

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(calls).toEqual([firstCanvas, secondCanvas])
  })

  it('should snapshot immediately and continue on the interval when auto mode is enabled', async () => {
    var recordedCallback
    var setTimeoutImpl = jasmine
      .createSpy('setTimeout')
      .and.callFake(function (callback) {
        recordedCallback = callback
        return 123
      })
    var clearTimeoutImpl = jasmine.createSpy('clearTimeout')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var stop = startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: setTimeoutImpl,
      clearTimeoutImpl: clearTimeoutImpl
    })

    await flushAutoSnapshotLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(setTimeoutImpl).toHaveBeenCalledWith(jasmine.any(Function), 1000)

    recordedCallback()
    await flushAutoSnapshotLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)

    stop()
    expect(clearTimeoutImpl).toHaveBeenCalledWith(123)
  })

  it('should avoid overlapping auto snapshot runs', async () => {
    var releaseSnapshot
    var snapshotDone = new Promise(function (resolve) {
      releaseSnapshot = resolve
    })
    var setTimeoutImpl = jasmine.createSpy('setTimeout').and.returnValue(123)
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(snapshotDone)

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: setTimeoutImpl,
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(setTimeoutImpl).not.toHaveBeenCalled()

    releaseSnapshot({ ok: true })
    await snapshotDone
    await flushAutoSnapshotLoop()
    expect(setTimeoutImpl).toHaveBeenCalledWith(jasmine.any(Function), 1000)

    var recordedCallback = setTimeoutImpl.calls.mostRecent().args[0]
    recordedCallback()
    await flushAutoSnapshotLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
  })

  it('should skip empty auto snapshot runs without blocking later snapshots', async () => {
    var recordedCallback
    var canvases = []
    var setTimeoutImpl = jasmine
      .createSpy('setTimeout')
      .and.callFake(function (callback) {
        recordedCallback = callback
        return 123
      })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000
      },
      getCanvases: function () {
        return canvases
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: setTimeoutImpl,
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()
    expect(snapshotCanvas).not.toHaveBeenCalled()

    canvases = [document.createElement('canvas')]
    recordedCallback()
    await flushAutoSnapshotLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
  })

  it('should cap the number of canvases processed in a single auto snapshot run', async () => {
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var thirdCanvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoMaxPerRun: 2
      },
      getCanvases: function () {
        return [firstCanvas, secondCanvas, thirdCanvas]
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: jasmine.createSpy('setTimeout').and.returnValue(123),
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(snapshotCanvas.calls.argsFor(0)).toEqual([firstCanvas])
    expect(snapshotCanvas.calls.argsFor(1)).toEqual([secondCanvas])
  })

  it('should rotate canvases across runs when auto max per run is smaller than the candidate set', async () => {
    var recordedCallback
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var thirdCanvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoCooldown: 0,
        replayCanvasAutoUnchangedBackoff: 0,
        replayCanvasAutoFailureBackoff: 0,
        replayCanvasAutoMaxPerRun: 2
      },
      getCanvases: function () {
        return [firstCanvas, secondCanvas, thirdCanvas]
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: jasmine
        .createSpy('setTimeout')
        .and.callFake(function (callback) {
          recordedCallback = callback
          return 123
        }),
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()
    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [firstCanvas],
      [secondCanvas]
    ])

    recordedCallback()
    await flushAutoSnapshotLoop()

    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [firstCanvas],
      [secondCanvas],
      [thirdCanvas],
      [firstCanvas]
    ])
  })

  it('should deprioritize canvases that just succeeded in favor of older peers', async () => {
    var recordedCallback
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var thirdCanvas = document.createElement('canvas')
    var nowTime = 1000
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoCooldown: 0,
        replayCanvasAutoUnchangedBackoff: 0,
        replayCanvasAutoFailureBackoff: 0,
        replayCanvasAutoMaxPerRun: 2
      },
      now: function () {
        return nowTime
      },
      getCanvases: function () {
        return [firstCanvas, secondCanvas, thirdCanvas]
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: jasmine
        .createSpy('setTimeout')
        .and.callFake(function (callback) {
          recordedCallback = callback
          return 123
        }),
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()
    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [firstCanvas],
      [secondCanvas]
    ])

    nowTime = 2000
    recordedCallback()
    await flushAutoSnapshotLoop()

    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [firstCanvas],
      [secondCanvas],
      [thirdCanvas],
      [firstCanvas]
    ])

    nowTime = 3000
    recordedCallback()
    await flushAutoSnapshotLoop()

    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [firstCanvas],
      [secondCanvas],
      [thirdCanvas],
      [firstCanvas],
      [secondCanvas],
      [thirdCanvas]
    ])
  })

  it('should prioritize canvases with a higher shouldRecordCanvas score', async () => {
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var thirdCanvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoMaxPerRun: 2,
        shouldRecordCanvas: function (canvas) {
          if (canvas === secondCanvas) {
            return 10
          }
          if (canvas === thirdCanvas) {
            return 5
          }
          return 0
        }
      },
      getCanvases: function () {
        return [firstCanvas, secondCanvas, thirdCanvas]
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: jasmine.createSpy('setTimeout').and.returnValue(123),
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()

    expect(snapshotCanvas.calls.allArgs()).toEqual([
      [secondCanvas],
      [thirdCanvas]
    ])
  })

  it('should pause auto snapshots while the document is hidden and resume on visibilitychange', async () => {
    var recordedVisibilityCallback
    var visibilityState = 'hidden'
    var visibilityStop = jasmine.createSpy('visibilityStop')
    var setTimeoutImpl = jasmine.createSpy('setTimeout').and.returnValue(123)
    var addEventListenerImpl = jasmine
      .createSpy('addEventListener')
      .and.callFake(function (_, __, callback) {
        recordedVisibilityCallback = callback
        return {
          stop: visibilityStop
        }
      })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))

    var stop = startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000
      },
      getCanvases: function () {
        return [document.createElement('canvas')]
      },
      getVisibilityState: function () {
        return visibilityState
      },
      addEventListenerImpl: addEventListenerImpl,
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: setTimeoutImpl,
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()
    expect(snapshotCanvas).not.toHaveBeenCalled()
    expect(setTimeoutImpl).not.toHaveBeenCalled()

    visibilityState = 'visible'
    recordedVisibilityCallback()
    await flushAutoSnapshotLoop()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(setTimeoutImpl).toHaveBeenCalledWith(jasmine.any(Function), 1000)

    stop()
    expect(visibilityStop).toHaveBeenCalled()
  })

  it('should report debug summaries for hidden skips and completed runs', async () => {
    var recordedVisibilityCallback
    var visibilityState = 'hidden'
    var onDebug = jasmine.createSpy('onDebug')
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: false, reason: 'unchanged' }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000,
        shouldRecordCanvas: function () {
          return 7
        }
      },
      getCanvases: function () {
        return [canvas]
      },
      getSerializedNodeId: function () {
        return 26
      },
      getVisibilityState: function () {
        return visibilityState
      },
      onDebug: onDebug,
      addEventListenerImpl: jasmine
        .createSpy('addEventListener')
        .and.callFake(function (_, __, callback) {
          recordedVisibilityCallback = callback
          return {
            stop: jasmine.createSpy('stop')
          }
        }),
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: jasmine.createSpy('setTimeout').and.returnValue(123),
      clearTimeoutImpl: jasmine.createSpy('clearTimeout'),
      now: function () {
        return 1234
      }
    })

    await flushAutoSnapshotLoop()

    expect(onDebug.calls.argsFor(0)[0]).toEqual({
      status: 'skipped_hidden',
      timestamp: 1234,
      eligibleCanvasCount: 0,
      selectedCanvasCount: 0,
      skippedBudgetCount: 0,
      results: []
    })

    visibilityState = 'visible'
    recordedVisibilityCallback()
    await flushAutoSnapshotLoop()

    expect(onDebug.calls.mostRecent().args[0]).toEqual({
      status: 'completed',
      timestamp: 1234,
      eligibleCanvasCount: 1,
      selectedCanvasCount: 1,
      skippedBudgetCount: 0,
      results: [
        {
          canvasId: 26,
          ok: false,
          reason: 'unchanged',
          priority: 7
        }
      ]
    })
  })

  it('should skip starting the loop when auto mode is disabled', () => {
    var setTimeoutImpl = jasmine.createSpy('setTimeout')
    var stop = startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'manual',
        replayCanvasAutoInterval: 1000
      },
      snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
      setTimeoutImpl: setTimeoutImpl,
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    expect(setTimeoutImpl).not.toHaveBeenCalled()
    expect(stop).toEqual(jasmine.any(Function))
  })

  it('should back off unchanged, below-threshold and failed canvases independently', () => {
    var now = 1000
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var thirdCanvas = document.createElement('canvas')
    var controller = createAutoCanvasSnapshotController(
      {
        replayCanvasAutoCooldown: 1000,
        replayCanvasAutoUnchangedBackoff: 3000,
        replayCanvasAutoFailureBackoff: 5000
      },
      function () {
        return now
      }
    )

    expect(controller.shouldSnapshot(firstCanvas)).toBeTrue()
    expect(controller.shouldSnapshot(secondCanvas)).toBeTrue()
    expect(controller.shouldSnapshot(thirdCanvas)).toBeTrue()

    controller.updateAfterSnapshot(firstCanvas, {
      ok: false,
      reason: 'unchanged'
    })
    controller.updateAfterSnapshot(secondCanvas, {
      ok: false,
      reason: 'below_threshold'
    })
    controller.updateAfterSnapshot(thirdCanvas, {
      ok: false,
      reason: 'encode_failed'
    })

    now = 3500
    expect(controller.shouldSnapshot(firstCanvas)).toBeFalse()
    expect(controller.shouldSnapshot(secondCanvas)).toBeFalse()
    expect(controller.shouldSnapshot(thirdCanvas)).toBeFalse()

    now = 4500
    expect(controller.shouldSnapshot(firstCanvas)).toBeTrue()
    expect(controller.shouldSnapshot(secondCanvas)).toBeTrue()
    expect(controller.shouldSnapshot(thirdCanvas)).toBeFalse()

    now = 6500
    expect(controller.shouldSnapshot(thirdCanvas)).toBeTrue()
  })

  it('should apply cooldown after successful auto snapshots', () => {
    var now = 1000
    var canvas = document.createElement('canvas')
    var controller = createAutoCanvasSnapshotController(
      {
        replayCanvasAutoCooldown: 1000,
        replayCanvasAutoUnchangedBackoff: 3000,
        replayCanvasAutoFailureBackoff: 5000
      },
      function () {
        return now
      }
    )

    controller.updateAfterSnapshot(canvas, { ok: true })

    expect(controller.shouldSnapshot(canvas)).toBeFalse()

    now = 2001
    expect(controller.shouldSnapshot(canvas)).toBeTrue()
  })

  it('should schedule the next run using the earliest backoff delay when all canvases are cooling down', async () => {
    var now = 1000
    var recordedCallback
    var scheduledDelay
    var canvas = document.createElement('canvas')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: false, reason: 'unchanged' }))

    startAutoCanvasSnapshotLoop({
      configuration: {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasAutoInterval: 1000,
        replayCanvasAutoCooldown: 1000,
        replayCanvasAutoUnchangedBackoff: 3000,
        replayCanvasAutoFailureBackoff: 5000
      },
      getCanvases: function () {
        return [canvas]
      },
      now: function () {
        return now
      },
      snapshotCanvas: snapshotCanvas,
      setTimeoutImpl: jasmine
        .createSpy('setTimeout')
        .and.callFake(function (callback, delay) {
          recordedCallback = callback
          scheduledDelay = delay
          return 123
        }),
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })

    await flushAutoSnapshotLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(scheduledDelay).toBe(3000)

    now = 4000
    recordedCallback()
    await flushAutoSnapshotLoop()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
  })
})
