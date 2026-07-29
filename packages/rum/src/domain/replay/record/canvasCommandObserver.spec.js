import { IncrementalSource, RecordType } from '../../../types'
import { markReplayInternalCanvas } from './canvasContext'
import { startCanvasCommandCapture } from './canvasCommandObserver'

describe('replay/record/canvasCommandObserver', () => {
  var originalGetContext

  function waitForAsyncSnapshotDebug() {
    return new Promise(function (resolve) {
      setTimeout(resolve, 0)
    })
  }

  beforeEach(() => {
    originalGetContext = HTMLCanvasElement.prototype.getContext
  })

  afterEach(() => {
    HTMLCanvasElement.prototype.getContext = originalGetContext
  })

  function createConfiguration(overrides) {
    return Object.assign(
      {
        replayCanvasEnabled: true,
        replayCanvasMode: 'auto',
        replayCanvasSampling: 'all'
      },
      overrides
    )
  }

  it('should patch 2d contexts returned by getContext', () => {
    var recordedFrameCallback
    var onDebug = jasmine.createSpy('onDebug')
    var onMutationDebug = jasmine.createSpy('onMutationDebug')
    var emit = jasmine.createSpy('emit')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      },
      onDebug: onDebug,
      onMutationDebug: onMutationDebug,
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      }
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 7 }
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()

    expect(context).not.toBeNull()
    expect(onMutationDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        timestamp: jasmine.any(Number),
        canvasId: 7,
        trigger: 'auto',
        approxBytesCount: jasmine.any(Number),
        commandCount: 1
      })
    )
    expect(onDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scheduler: 'command_capture',
        status: 'completed',
        startedAt: jasmine.any(Number),
        completedAt: jasmine.any(Number),
        selectedCanvasCount: 1
      })
    )
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        startedAt: jasmine.any(Number),
        completedAt: jasmine.any(Number),
        type: RecordType.IncrementalSnapshot,
        data: jasmine.objectContaining({
          source: IncrementalSource.CanvasMutation,
          id: 7
        })
      })
    )

    recorder.stop()
  })

  it('should request a bitmap fallback when the replay sink rejects commands', async () => {
    var recordedFrameCallback
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1,
        replayCanvasAutoFailureBackoff: 1
      }),
      emit: jasmine.createSpy('emit').and.returnValue(false),
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      },
      snapshotCanvas: snapshotCanvas,
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      }
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 70 }
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({
        scheduler: 'command_capture',
        reason: 'command_record_rejected',
        force: true
      })
    )

    recorder.stop()
  })

  it('should retry a rejected bitmap fallback when the canvas becomes static', async () => {
    var recordedFrameCallback
    var scheduledMicrotasks = []
    var scheduledTimers = []
    var currentTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValues(
        Promise.resolve({ ok: false, reason: 'record_rejected' }),
        Promise.resolve({ ok: true })
      )
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1,
        replayCanvasAutoFailureBackoff: 1000,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasAutoMaxPerRun: 1
      }),
      emit: jasmine.createSpy('emit').and.returnValue(false),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      },
      now: function () {
        return currentTime
      },
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      cancelAnimationFrameImpl: function () {},
      scheduleMicrotask: function (callback) {
        scheduledMicrotasks.push(callback)
      },
      setTimeoutImpl: function (callback, delay) {
        scheduledTimers.push({ callback: callback, delay: delay })
        return scheduledTimers.length
      },
      clearTimeoutImpl: function () {}
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 700 }
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()
    scheduledMicrotasks.shift()()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(snapshotCanvas.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({ force: true })
    )
    expect(scheduledTimers.length).toBe(1)
    expect(scheduledTimers[0].delay).toBe(1000)

    currentTime = 1000
    scheduledTimers[0].callback()
    scheduledMicrotasks.shift()()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    recorder.stop()
  })

  it('should retry a static bitmap when its canvas is published after polling is exhausted', async () => {
    var recordedFrameCallback
    var scheduledMicrotasks = []
    var scheduledTimers = []
    var currentTime = 0
    var isSerialized = false
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function () {
        return Promise.resolve(
          isSerialized
            ? { ok: true }
            : { ok: false, reason: 'not_serialized' }
        )
      })
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1,
        replayCanvasAutoFailureBackoff: 1000,
        replayCanvasMaxConcurrentEncodes: 1,
        replayCanvasAutoMaxPerRun: 1
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      getSerializedNodeId: function () {
        return isSerialized ? 701 : undefined
      },
      now: function () {
        return currentTime
      },
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      },
      cancelAnimationFrameImpl: function () {},
      scheduleMicrotask: function (callback) {
        scheduledMicrotasks.push(callback)
      },
      setTimeoutImpl: function (callback, delay) {
        scheduledTimers.push({ callback: callback, delay: delay })
        return scheduledTimers.length
      },
      clearTimeoutImpl: function () {}
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()
    scheduledMicrotasks.shift()()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(scheduledTimers.length).toBe(1)
    expect(scheduledTimers[0].delay).toBe(120)

    for (var retryIndex = 0; retryIndex < 7; retryIndex += 1) {
      currentTime += 120
      scheduledTimers[retryIndex].callback()
      scheduledMicrotasks.shift()()
      await waitForAsyncSnapshotDebug()
    }

    expect(snapshotCanvas).toHaveBeenCalledTimes(8)
    expect(scheduledTimers.length).toBe(7)

    isSerialized = true
    recorder.$rRetryPublishedCanvas(canvas)
    scheduledMicrotasks.shift()()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(9)
    recorder.stop()
  })

  it('should use command recorder side-channel estimates without stringifying commands again', () => {
    var recordedFrameCallback
    var onMutationDebug = jasmine.createSpy('onMutationDebug')
    var emit = jasmine.createSpy('emit')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      },
      onMutationDebug: onMutationDebug,
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      }
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 8 }
    var context = canvas.getContext('2d')
    var stringify = spyOn(JSON, 'stringify').and.callThrough()

    context.fillText('side-channel', 1, 2)
    recordedFrameCallback()

    expect(stringify).not.toHaveBeenCalled()
    expect(onMutationDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        canvasId: 8,
        approxBytesCount: jasmine.any(Number),
        commandCount: 1
      })
    )
    var record = emit.calls.mostRecent().args[0]
    expect(record.approxBytesCount).toBeUndefined()
    expect(record.commandCount).toBeUndefined()
    expect(record.data.approxBytesCount).toBeUndefined()
    expect(record.data.commandCount).toBeUndefined()

    recorder.stop()
  })

  it('should flush pending commands before a recorded canvas dimension resets its context', () => {
    var emit = jasmine.createSpy('emit')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      }
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 81 }
    var context = canvas.getContext('2d')
    context.fillRect(1, 2, 3, 4)

    var internalCanvas = markReplayInternalCanvas(
      document.createElement('canvas')
    )
    internalCanvas.width = 10
    expect(emit).not.toHaveBeenCalled()

    canvas.width = 20

    expect(emit).toHaveBeenCalledTimes(1)
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          id: 81,
          commands: [
            jasmine.objectContaining({
              property: 'fillRect',
              args: [1, 2, 3, 4]
            })
          ]
        })
      })
    )
    recorder.stop()
  })

  it('should flush the final command batch before stopping', () => {
    var emit = jasmine.createSpy('emit')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      }
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 82 }
    canvas.getContext('2d').fillRect(1, 2, 3, 4)

    recorder.stop()

    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          id: 82,
          commands: [
            jasmine.objectContaining({
              property: 'fillRect',
              args: [1, 2, 3, 4]
            })
          ]
        })
      })
    )
  })

  it('should not snapshot serialized canvases on startup without a known 2d context', () => {
    var patchContext = jasmine.createSpy('patchContext')
    var patchSharedPrototype = jasmine.createSpy('patchSharedPrototype')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var canvas = document.createElement('canvas')
    startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getSerializedNodeId: function () {
        return 9
      },
      getCanvases: function () {
        return [canvas]
      },
      commandRecorder: {
        patchSharedPrototype: patchSharedPrototype,
        patchContext: patchContext,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(patchSharedPrototype).toHaveBeenCalled()
    expect(patchContext).not.toHaveBeenCalled()
    expect(snapshotCanvas).not.toHaveBeenCalled()
  })

  it('should resolve canvas ids from getSerializedNodeId instead of __sn', () => {
    var recordedFrameCallback
    var onMutationDebug = jasmine.createSpy('onMutationDebug')
    var emit = jasmine.createSpy('emit')
    var canvas = document.createElement('canvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      getSerializedNodeId: function (node) {
        return node === canvas ? 77 : undefined
      },
      getCanvases: function () {
        return [canvas]
      },
      onMutationDebug: onMutationDebug,
      requestAnimationFrameImpl: function (callback) {
        recordedFrameCallback = callback
        return 1
      }
    })
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recordedFrameCallback()

    expect(onMutationDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        canvasId: 77
      })
    )
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          id: 77
        })
      })
    )
    recorder.stop()
  })

  it('should snapshot-fallback a 2d context created before the observer starts', async () => {
    var onMutationDebug = jasmine.createSpy('onMutationDebug')
    var emit = jasmine.createSpy('emit')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 71 }
    var existingContext = canvas.getContext('2d')

    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      getSerializedNodeId: function (node) {
        return node && node.__sn && node.__sn.id
      },
      getCanvases: function () {
        return [canvas]
      },
      snapshotCanvas: snapshotCanvas,
      onMutationDebug: onMutationDebug
    })

    existingContext.fillRect(1, 2, 3, 4)
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({
        scheduler: 'command_capture',
        reason: 'existing_canvas_context'
      })
    )
    expect(onMutationDebug).not.toHaveBeenCalled()
    expect(emit).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should expose a scanExistingCanvases hook for known 2d canvases discovered later', async () => {
    var patchContext = jasmine.createSpy('patchContext')
    var patchSharedPrototype = jasmine.createSpy('patchSharedPrototype')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var onDebug = jasmine.createSpy('onDebug')
    var markPersistentSnapshotFallback = jasmine.createSpy(
      'markPersistentSnapshotFallback'
    )
    var canvases = []
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      getSerializedNodeId: function () {
        return 18
      },
      getCanvases: function () {
        return canvases
      },
      commandRecorder: {
        patchSharedPrototype: patchSharedPrototype,
        patchContext: patchContext,
        markPersistentSnapshotFallback: markPersistentSnapshotFallback,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })

    expect(patchContext).not.toHaveBeenCalled()

    var canvas = document.createElement('canvas')
    canvases.push(canvas)
    var context = canvas.getContext('2d')
    expect(context).not.toBeNull()
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()

    expect(patchContext).toHaveBeenCalledWith(context)
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(snapshotCanvas).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({ force: true })
    )
    expect(markPersistentSnapshotFallback).toHaveBeenCalledWith(
      context,
      'initial_bitmap_state'
    )
    expect(onDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        scheduler: 'command_capture',
        status: 'completed',
        selectedCanvasCount: 1,
        results: [
          jasmine.objectContaining({
            canvasId: 18,
            ok: true
          })
        ]
      })
    )
    recorder.stop()
  })

  it('should snapshot known static 2d canvases only once until reset', async () => {
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var canvases = []
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getSerializedNodeId: function () {
        return 17
      },
      getCanvases: function () {
        return canvases
      }
    })
    var canvas = document.createElement('canvas')
    canvases.push(canvas)
    canvas.getContext('2d')
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    recorder.reset()
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)

    recorder.stop()
  })

  it('should adopt an admitted bitmap baseline without encoding it again', async () => {
    var canvases = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas')
    var markPersistentSnapshotFallback = jasmine.createSpy(
      'markPersistentSnapshotFallback'
    )
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return canvases
      },
      getSerializedNodeId: function () {
        return 170
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop'),
        markPersistentSnapshotFallback: markPersistentSnapshotFallback
      }
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    var token = recorder.createCanvasSnapshotBaselineToken(canvas)

    expect(
      recorder.markCanvasSnapshotBaseline(
        canvas,
        token,
        'full_snapshot_baseline'
      )
    ).toBe(true)
    canvases.push(canvas)
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).not.toHaveBeenCalled()
    expect(markPersistentSnapshotFallback).toHaveBeenCalledWith(
      context,
      'full_snapshot_baseline'
    )
    recorder.stop()
  })

  it('should rebaseline a canvas mutated after its admitted bitmap snapshot', () => {
    var canvases = []
    var forceSnapshotFallback = jasmine.createSpy(
      'forceSnapshotFallback'
    )
    var resume = jasmine.createSpy('resume')
    var canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: jasmine.createSpy('snapshotCanvas'),
      getCanvases: function () {
        return canvases
      },
      getSerializedNodeId: function () {
        return 171
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop'),
        resume: resume,
        forceSnapshotFallback: forceSnapshotFallback,
        markPersistentSnapshotFallback: jasmine.createSpy(
          'markPersistentSnapshotFallback'
        )
      }
    })
    canvas.getContext('2d')
    var token = recorder.createCanvasSnapshotBaselineToken(canvas)

    expect(
      recorder.markCanvasSnapshotBaseline(
        canvas,
        token,
        'full_snapshot_baseline'
      )
    ).toBe(true)
    canvas.width += 1
    canvases.push(canvas)
    recorder.scanExistingCanvases()

    expect(resume).toHaveBeenCalledTimes(1)
    expect(forceSnapshotFallback).toHaveBeenCalledWith(
      canvas.getContext('2d'),
      'bitmap_changed_after_snapshot'
    )
    recorder.stop()
    canvas.remove()
  })

  it('should keep a pre-init context on bitmap mode when it is reacquired', async () => {
    var frameCallbacks = []
    var microtasks = []
    var emit = jasmine.createSpy('emit')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var canvas = document.createElement('canvas')
    var existingContext = canvas.getContext('2d')
    existingContext.translate(12, 8)
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: emit,
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })
    var token = recorder.createCanvasSnapshotBaselineToken(canvas)
    expect(
      recorder.markCanvasSnapshotBaseline(
        canvas,
        token,
        'full_snapshot_baseline'
      )
    ).toBe(true)

    expect(canvas.getContext('2d')).toBe(existingContext)
    existingContext.fillRect(0, 0, 2, 2)
    frameCallbacks.shift()()
    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()

    expect(emit).not.toHaveBeenCalled()
    expect(snapshotCanvas).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({
        reason: 'existing_bitmap_state',
        force: true
      })
    )
    recorder.stop()
  })

  it('should force a fresh bitmap when a canvas mutates during encoding', async () => {
    var microtasks = []
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      }
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    var token = recorder.createCanvasSnapshotBaselineToken(canvas)

    context.fillRect(0, 0, 2, 2)
    expect(
      recorder.markCanvasSnapshotBaseline(
        canvas,
        token,
        'manual_snapshot'
      )
    ).toBe(true)
    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledWith(
      canvas,
      jasmine.objectContaining({
        reason: 'bitmap_changed_during_snapshot',
        force: true
      })
    )
    recorder.stop()
  })

  it('should process initial static canvas snapshots sequentially', async () => {
    var firstResolve
    var secondResolve
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.callFake(
      function (canvas) {
        return new Promise(function (resolve) {
          if (!firstResolve) {
            firstResolve = resolve
            return
          }
          secondResolve = resolve
        })
      }
    )
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      hasCanvasContent: function () {
        return false
      },
      getSerializedNodeId: function (canvas) {
        return canvas === firstCanvas ? 31 : 32
      },
      getCanvases: function () {
        return [firstCanvas, secondCanvas]
      }
    })

    firstCanvas.getContext('2d')
    secondCanvas.getContext('2d')
    snapshotCanvas.calls.reset()
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas.calls.count()).toBe(1)
    expect(snapshotCanvas.calls.argsFor(0)[0]).toBe(firstCanvas)

    firstResolve({ ok: true })
    await waitForAsyncSnapshotDebug()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas.calls.count()).toBe(2)
    expect(snapshotCanvas.calls.argsFor(1)[0]).toBe(secondCanvas)

    secondResolve({ ok: true })
    await waitForAsyncSnapshotDebug()
    recorder.stop()
  })

  it('should retry initial static canvas snapshot after a previous failure', async () => {
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValues(
        Promise.resolve({ ok: false, reason: 'encode_failed' }),
        Promise.resolve({ ok: true })
      )
    var canvas = document.createElement('canvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      hasCanvasContent: function () {
        return false
      },
      getSerializedNodeId: function () {
        return 41
      },
      getCanvases: function () {
        return [canvas]
      }
    })

    canvas.getContext('2d')
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    recorder.stop()
  })

  it('should ignore stale initial static canvas results after reset', async () => {
    var patchSharedPrototype = jasmine.createSpy('patchSharedPrototype')
    var deferredResolve
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.returnValue(
      new Promise(function (resolve) {
        deferredResolve = resolve
      })
    )
    var onDebug = jasmine.createSpy('onDebug')
    var canvas = document.createElement('canvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      getSerializedNodeId: function () {
        return 19
      },
      getCanvases: function () {
        return [canvas]
      },
      commandRecorder: {
        patchSharedPrototype: patchSharedPrototype,
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })

    canvas.getContext('2d')
    recorder.scanExistingCanvases()
    recorder.reset()
    deferredResolve({ ok: true })
    await waitForAsyncSnapshotDebug()

    expect(onDebug).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should not let an old initial snapshot finalizer release a new generation slot', async () => {
    var snapshots = []
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function (canvas) {
        return new Promise(function (resolve) {
          snapshots.push({
            canvas: canvas,
            resolve: resolve
          })
        })
      })
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var canvases = [firstCanvas, secondCanvas]
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getSerializedNodeId: function (canvas) {
        return canvas === firstCanvas ? 51 : 52
      },
      getCanvases: function () {
        return canvases
      }
    })

    firstCanvas.getContext('2d')
    secondCanvas.getContext('2d')
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    expect(snapshots.length).toBe(1)
    expect(snapshots[0].canvas).toBe(firstCanvas)

    recorder.reset()
    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    expect(snapshots.length).toBe(2)
    expect(snapshots[1].canvas).toBe(firstCanvas)

    snapshots[0].resolve({ ok: true })
    await waitForAsyncSnapshotDebug()
    expect(snapshots.length).toBe(2)

    snapshots[1].resolve({ ok: true })
    await waitForAsyncSnapshotDebug()
    expect(snapshots.length).toBe(3)
    expect(snapshots[2].canvas).toBe(secondCanvas)

    snapshots[2].resolve({ ok: true })
    await waitForAsyncSnapshotDebug()
    recorder.stop()
  })

  it('should scan 130 initial canvases in rolling batches of at most 64', async () => {
    var canvases = []
    var nextScanIndex = 0
    var returnedBatchSizes = []
    var getCanvases = jasmine
      .createSpy('getCanvases')
      .and.callFake(function (maxScanCount) {
        if (!canvases.length) {
          returnedBatchSizes.push(0)
          return []
        }
        var batch = canvases.slice(
          nextScanIndex,
          nextScanIndex + maxScanCount
        )
        nextScanIndex += batch.length
        if (nextScanIndex >= canvases.length) {
          nextScanIndex = 0
        }
        returnedBatchSizes.push(batch.length)
        return batch
      })
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getSerializedNodeId: function (canvas) {
        return canvas.__sn && canvas.__sn.id
      },
      getCanvases: getCanvases
    })

    for (var index = 0; index < 130; index += 1) {
      var canvas = document.createElement('canvas')
      canvas.__sn = { id: index + 1000 }
      canvas.getContext('2d')
      canvases.push(canvas)
    }

    recorder.scanExistingCanvases()
    await waitForAsyncSnapshotDebug()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(130)
    getCanvases.calls.allArgs().forEach(function (args) {
      expect(args).toEqual([64])
    })
    returnedBatchSizes.forEach(function (batchSize) {
      expect(batchSize).toBeLessThanOrEqual(64)
    })
    expect(
      snapshotCanvas.calls.allArgs().map(function (args) {
        return args[0].__sn.id
      })
    ).toEqual(
      canvases.map(function (canvas) {
        return canvas.__sn.id
      })
    )
    recorder.stop()
  })

  it('should ignore stale initial static canvas results after stop', async () => {
    var patchSharedPrototype = jasmine.createSpy('patchSharedPrototype')
    var deferredResolve
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas').and.returnValue(
      new Promise(function (resolve) {
        deferredResolve = resolve
      })
    )
    var onDebug = jasmine.createSpy('onDebug')
    var canvas = document.createElement('canvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      getSerializedNodeId: function () {
        return 20
      },
      getCanvases: function () {
        return [canvas]
      },
      commandRecorder: {
        patchSharedPrototype: patchSharedPrototype,
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })

    canvas.getContext('2d')
    recorder.scanExistingCanvases()
    recorder.stop()
    deferredResolve({ ok: true })
    await waitForAsyncSnapshotDebug()

    expect(onDebug).not.toHaveBeenCalled()
  })

  it('should patch known existing 2d contexts without creating a new one during scan', () => {
    var patchContext = jasmine.createSpy('patchContext')
    var patchSharedPrototype = jasmine.createSpy('patchSharedPrototype')
    var canvases = []
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return canvases
      },
      commandRecorder: {
        patchSharedPrototype: patchSharedPrototype,
        patchContext: patchContext,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })

    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    canvases.push(canvas)
    patchContext.calls.reset()

    recorder.scanExistingCanvases()

    expect(context).not.toBeNull()
    expect(patchContext).toHaveBeenCalledWith(context)
    recorder.stop()
  })

  it('should not patch non-2d contexts', () => {
    var patchContext = jasmine.createSpy('patchContext')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return []
      },
      commandRecorder: {
        patchContext: patchContext,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })
    var canvas = document.createElement('canvas')
    canvas.getContext('webgl')

    expect(patchContext).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should respect shouldRecordCanvas returning false', () => {
    var patchContext = jasmine.createSpy('patchContext')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        shouldRecordCanvas: function () {
          return false
        }
      }),
      emit: jasmine.createSpy('emit'),
      commandRecorder: {
        patchContext: patchContext,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })
    document.createElement('canvas').getContext('2d')

    expect(patchContext).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should not let a throwing shouldRecordCanvas hook break getContext', () => {
    var patchContext = jasmine.createSpy('patchContext')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        shouldRecordCanvas: function () {
          throw new Error('customer hook failed')
        }
      }),
      emit: jasmine.createSpy('emit'),
      commandRecorder: {
        patchContext: patchContext,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })
    var context

    expect(function () {
      context = document.createElement('canvas').getContext('2d')
    }).not.toThrow()
    expect(context).not.toBeNull()
    expect(patchContext).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should cache rejected contexts across draw calls until reset', () => {
    var shouldRecordCanvas = jasmine
      .createSpy('shouldRecordCanvas')
      .and.returnValue(false)
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        shouldRecordCanvas: shouldRecordCanvas
      }),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return []
      }
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')

    expect(shouldRecordCanvas).toHaveBeenCalledTimes(1)

    context.fillRect(0, 0, 1, 1)
    context.fillRect(1, 1, 1, 1)
    context.fillStyle = '#f00'

    expect(shouldRecordCanvas).toHaveBeenCalledTimes(1)

    recorder.reset()
    context.fillRect(2, 2, 1, 1)

    expect(shouldRecordCanvas).toHaveBeenCalledTimes(2)
    recorder.stop()
  })

  it('should ignore canvases owned by the replay encoder', () => {
    var patchContext = jasmine.createSpy('patchContext')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      commandRecorder: {
        patchContext: patchContext,
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop')
      }
    })
    var canvas = markReplayInternalCanvas(document.createElement('canvas'))

    canvas.getContext('2d')

    expect(patchContext).not.toHaveBeenCalled()
    recorder.stop()
  })

  it('should restore original getContext on stop', () => {
    var originalWidthSetter = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      'width'
    ).set
    var originalHeightSetter = Object.getOwnPropertyDescriptor(
      HTMLCanvasElement.prototype,
      'height'
    ).set
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit')
    })

    expect(HTMLCanvasElement.prototype.getContext).not.toBe(originalGetContext)
    expect(
      Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        'width'
      ).set
    ).not.toBe(originalWidthSetter)
    expect(
      Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        'height'
      ).set
    ).not.toBe(originalHeightSetter)

    recorder.stop()

    expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext)
    expect(
      Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        'width'
      ).set
    ).toBe(originalWidthSetter)
    expect(
      Object.getOwnPropertyDescriptor(
        HTMLCanvasElement.prototype,
        'height'
      ).set
    ).toBe(originalHeightSetter)
  })

  it('should preserve a later getContext patch when stopping', () => {
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit')
    })
    var sdkGetContext = HTMLCanvasElement.prototype.getContext
    var laterGetContext = function () {
      return sdkGetContext.apply(this, arguments)
    }
    HTMLCanvasElement.prototype.getContext = laterGetContext

    recorder.stop()

    expect(HTMLCanvasElement.prototype.getContext).toBe(
      laterGetContext
    )
  })

  it('should resume a fallback queued by a cooldown timer while hidden', async () => {
    var microtasks = []
    var frameCallbacks = []
    var timers = []
    var nowTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(false)
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1000,
        replayCanvasMaxConcurrentEncodes: 1
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return canvas ? [canvas] : []
      },
      getSerializedNodeId: function (canvas) {
        return canvas.__sn && canvas.__sn.id
      },
      now: function () {
        return nowTime
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        timers.push({
          callback: callback,
          delay: delay
        })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 81 }
    var context = canvas.getContext('2d')
    var gradient = context.createLinearGradient(0, 0, 1, 1)
    context.fillStyle = gradient

    microtasks.shift()()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    // Clear the command batch that requested the initial fallback.
    frameCallbacks.shift()()
    context.fillRect(0, 0, 1, 1)
    frameCallbacks.shift()()
    expect(timers.length).toBe(1)
    expect(timers[0].delay).toBe(1000)

    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    nowTime = 1000
    timers[0].callback()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    recorder.stop()
  })

  it('should retain a static fallback tail when the cooldown timer cap is full', async () => {
    var microtasks = []
    var frameCallbacks = []
    var timers = []
    var weakRefs = []
    var nowTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1000,
        replayCanvasMaxConcurrentEncodes: 2
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      now: function () {
        return nowTime
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        timers.push({
          callback: callback,
          delay: delay
        })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout'),
      weakRefFactory: function (canvas) {
        var deref = jasmine
          .createSpy('deref')
          .and.returnValue(canvas)
        weakRefs.push({ deref: deref })
        return weakRefs[weakRefs.length - 1]
      },
      maxFallbackTimerCount: 1,
      maxFallbackTimerDelay: 25
    })
    var contexts = []
    for (var index = 0; index < 2; index += 1) {
      var canvas = document.createElement('canvas')
      var context = canvas.getContext('2d')
      context.fillStyle = context.createLinearGradient(0, 0, 1, 1)
      contexts.push(context)
    }

    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(2)

    while (frameCallbacks.length) {
      frameCallbacks.shift()()
    }
    contexts.forEach(function (context) {
      context.fillRect(0, 0, 1, 1)
    })
    while (frameCallbacks.length) {
      frameCallbacks.shift()()
    }

    expect(timers.length).toBe(1)
    expect(timers[0].delay).toBe(25)
    expect(weakRefs.length).toBe(1)

    nowTime = 1000
    timers[0].callback()
    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(4)
    contexts.forEach(function (context) {
      expect(snapshotCanvas).toHaveBeenCalledWith(
        context.canvas,
        jasmine.objectContaining({ scheduler: 'command_capture' })
      )
    })
    recorder.stop()
  })

  it('should preserve a bounded trailing fallback snapshot without WeakRef', async () => {
    var microtasks = []
    var frameCallbacks = []
    var timers = []
    var nowTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1000
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      now: function () {
        return nowTime
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        timers.push({ callback: callback, delay: delay })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout'),
      weakRefFactory: null,
      maxFallbackTimerCount: 1
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    context.fillStyle = context.createLinearGradient(0, 0, 1, 1)

    microtasks.shift()()
    await waitForAsyncSnapshotDebug()
    expect(snapshotCanvas).toHaveBeenCalledTimes(1)

    frameCallbacks.shift()()
    context.fillRect(0, 0, 2, 2)
    frameCallbacks.shift()()

    expect(timers.length).toBe(1)
    expect(timers[0].delay).toBe(1000)

    nowTime = 1000
    timers[0].callback()
    microtasks.shift()()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    expect(snapshotCanvas.calls.mostRecent().args[0]).toBe(canvas)
    recorder.stop()
  })

  it('should preserve a bounded trailing fallback when WeakRef construction fails', async () => {
    var microtasks = []
    var frameCallbacks = []
    var timers = []
    var nowTime = 0
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var weakRefFactory = jasmine
      .createSpy('weakRefFactory')
      .and.throwError('WeakRef unavailable')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoCooldown: 1000
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      now: function () {
        return nowTime
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function (callback) {
        frameCallbacks.push(callback)
        return frameCallbacks.length
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame'),
      setTimeoutImpl: function (callback, delay) {
        timers.push({ callback: callback, delay: delay })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout'),
      weakRefFactory: weakRefFactory,
      maxFallbackTimerCount: 1
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    context.fillStyle = context.createLinearGradient(0, 0, 1, 1)

    microtasks.shift()()
    await waitForAsyncSnapshotDebug()
    frameCallbacks.shift()()
    context.fillRect(0, 0, 2, 2)
    frameCallbacks.shift()()

    expect(weakRefFactory).toHaveBeenCalledTimes(1)
    expect(timers.length).toBe(1)
    nowTime = 1000
    timers[0].callback()
    microtasks.shift()()
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)
    expect(snapshotCanvas.calls.mostRecent().args[0]).toBe(canvas)
    recorder.stop()
  })

  it('should retain static fallback canvases when the active queue is full', async () => {
    var microtasks = []
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      getSerializedNodeId: function (canvas) {
        return canvas.__sn && canvas.__sn.id
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      }
    })
    var canvases = []
    for (var canvasIndex = 0; canvasIndex < 6; canvasIndex += 1) {
      var canvas = document.createElement('canvas')
      canvas.__sn = { id: 90 + canvasIndex }
      var context = canvas.getContext('2d')
      var gradient = context.createLinearGradient(0, 0, 1, 1)
      context.fillStyle = gradient
      canvases.push(canvas)
    }

    var drainCount = 0
    while (
      snapshotCanvas.calls.count() < canvases.length &&
      drainCount < canvases.length + 2
    ) {
      while (microtasks.length) {
        microtasks.shift()()
      }
      await waitForAsyncSnapshotDebug()
      drainCount += 1
    }

    expect(snapshotCanvas).toHaveBeenCalledTimes(canvases.length)
    canvases.forEach(function (canvas) {
      expect(snapshotCanvas).toHaveBeenCalledWith(
        canvas,
        jasmine.objectContaining({
          scheduler: 'command_capture'
        })
      )
    })
    recorder.stop()
  })

  it('should clamp extreme fallback concurrency and queue sizes', async () => {
    var microtasks = []
    var snapshotResolvers = []
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function () {
        return new Promise(function (resolve) {
          snapshotResolvers.push(resolve)
        })
      })
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoMaxPerRun: Number.MAX_SAFE_INTEGER,
        replayCanvasMaxConcurrentEncodes: Number.MAX_SAFE_INTEGER
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      getSerializedNodeId: function (canvas) {
        return canvas.__sn && canvas.__sn.id
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function () {
        return 1
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })

    for (var canvasIndex = 0; canvasIndex < 100; canvasIndex += 1) {
      var canvas = document.createElement('canvas')
      canvas.__sn = { id: 200 + canvasIndex }
      var context = canvas.getContext('2d')
      context.fillStyle = context.createLinearGradient(0, 0, 1, 1)
    }

    microtasks.shift()()
    await Promise.resolve()
    await Promise.resolve()
    expect(snapshotCanvas).toHaveBeenCalledTimes(4)

    var resolvedSnapshotCount = 0
    for (var drainRound = 0; drainRound < 16; drainRound += 1) {
      while (resolvedSnapshotCount < snapshotResolvers.length) {
        snapshotResolvers[resolvedSnapshotCount]({ ok: true })
        resolvedSnapshotCount += 1
      }
      await waitForAsyncSnapshotDebug()
      while (microtasks.length) {
        microtasks.shift()()
      }
      await Promise.resolve()
      await Promise.resolve()
    }

    // The active queue and retry queue retain one fixed 64-entry page. The
    // rest are intentionally dropped instead of growing with the user value.
    expect(snapshotCanvas).toHaveBeenCalledTimes(64)
    recorder.stop()
  })

  it('should drain each 64-canvas visibility page before scanning the next', async () => {
    var canvases = []
    var microtasks = []
    var visibilityScanStarted = false
    var visibilityPage = 0
    var snapshotsAtSecondPage
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoMaxPerRun: 1,
        replayCanvasMaxConcurrentEncodes: 1
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        if (!visibilityScanStarted) {
          return []
        }
        visibilityPage += 1
        if (visibilityPage === 1) {
          return canvases.slice(0, 64)
        }
        if (visibilityPage === 2) {
          snapshotsAtSecondPage = snapshotCanvas.calls.count()
          return canvases.slice(64)
        }
        return canvases.slice(0, 64)
      },
      getSerializedNodeId: function (canvas) {
        return canvas.__sn.id
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      }
    })
    for (var index = 0; index < 65; index += 1) {
      var canvas = document.createElement('canvas')
      canvas.__sn = { id: 5000 + index }
      canvas.getContext('2d')
      canvases.push(canvas)
    }

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    visibilityScanStarted = true
    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))

    for (var round = 0; round < 150 && snapshotCanvas.calls.count() < 65; round += 1) {
      while (microtasks.length) {
        microtasks.shift()()
      }
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
    }

    expect(snapshotCanvas).toHaveBeenCalledTimes(65)
    expect(snapshotsAtSecondPage).toBe(64)
    recorder.stop()
  })

  it('should continue a visibility scan across an empty sparse page', () => {
    var microtasks = []
    var scanStarted = false
    var scanPage = 0
    var forceSnapshotFallback = jasmine.createSpy(
      'forceSnapshotFallback'
    )
    var canvas = document.createElement('canvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        if (!scanStarted) {
          return []
        }
        scanPage += 1
        if (scanPage === 1) {
          return []
        }
        return [canvas]
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop'),
        pause: jasmine.createSpy('pause'),
        resume: jasmine.createSpy('resume'),
        reset: jasmine.createSpy('reset'),
        forceSnapshotFallback: forceSnapshotFallback
      }
    })
    var context = canvas.getContext('2d')
    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    scanStarted = true
    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    while (microtasks.length) {
      microtasks.shift()()
    }

    expect(scanPage).toBe(3)
    expect(forceSnapshotFallback).toHaveBeenCalledOnceWith(
      context,
      'visibility_rebaseline'
    )
    recorder.stop()
  })

  it('should discard stale fallback drains after reset and stop', async () => {
    var microtasks = []
    var snapshotCanvas = jasmine.createSpy('snapshotCanvas')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      getCanvases: function () {
        return []
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      requestAnimationFrameImpl: function () {
        return 1
      },
      cancelAnimationFrameImpl: jasmine.createSpy('cancelAnimationFrame')
    })
    var canvas = document.createElement('canvas')
    var context = canvas.getContext('2d')
    context.fillStyle = context.createLinearGradient(0, 0, 1, 1)

    recorder.reset()
    context.fillStyle = context.createLinearGradient(0, 0, 2, 2)
    recorder.stop()
    while (microtasks.length) {
      microtasks.shift()()
    }
    await Promise.resolve()
    await Promise.resolve()

    expect(snapshotCanvas).not.toHaveBeenCalled()
  })

  it('should pause and discard pending commands on reset, then resume for the new baseline', () => {
    var flush = jasmine.createSpy('flush')
    var pause = jasmine.createSpy('pause')
    var reset = jasmine.createSpy('reset')
    var resume = jasmine.createSpy('resume')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return []
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: flush,
        pause: pause,
        reset: reset,
        resume: resume,
        stop: jasmine.createSpy('stop')
      }
    })

    recorder.reset()

    expect(flush).not.toHaveBeenCalled()
    expect(pause).toHaveBeenCalledBefore(reset)
    expect(reset).toHaveBeenCalledTimes(1)

    recorder.scanExistingCanvases()
    expect(resume).toHaveBeenCalledTimes(1)
    recorder.stop()
  })

  it('should pause on hidden and resume on visible', () => {
    var flush = jasmine.createSpy('flush')
    var pause = jasmine.createSpy('pause')
    var resume = jasmine.createSpy('resume')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return []
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: flush,
        stop: jasmine.createSpy('stop'),
        pause: pause,
        resume: resume
      }
    })

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledBefore(pause)
    expect(pause).toHaveBeenCalledTimes(1)

    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(resume).toHaveBeenCalledTimes(1)

    recorder.stop()
  })

  it('should stay paused across visibility changes until the full snapshot baseline completes', () => {
    var pause = jasmine.createSpy('pause')
    var resume = jasmine.createSpy('resume')
    var reset = jasmine.createSpy('reset')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      startPaused: true,
      getCanvases: function () {
        return []
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop'),
        pause: pause,
        resume: resume,
        reset: reset
      }
    })
    expect(pause).toHaveBeenCalledTimes(1)

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(resume).not.toHaveBeenCalled()
    expect(reset).not.toHaveBeenCalled()

    recorder.scanExistingCanvases()
    expect(resume).toHaveBeenCalledTimes(1)
    recorder.stop()
  })

  it('should resume commands before scheduling a visibility bitmap rebaseline', () => {
    var flush = jasmine.createSpy('flush')
    var pause = jasmine.createSpy('pause')
    var resume = jasmine.createSpy('resume')
    var reset = jasmine.createSpy('reset')
    var forceSnapshotFallback = jasmine.createSpy(
      'forceSnapshotFallback'
    )
    var canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return [canvas]
      },
      getSerializedNodeId: function () {
        return 42
      },
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: flush,
        stop: jasmine.createSpy('stop'),
        pause: pause,
        resume: resume,
        reset: reset,
        forceSnapshotFallback: forceSnapshotFallback
      }
    })
    canvas.getContext('2d')

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(flush).toHaveBeenCalledBefore(pause)

    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))

    expect(reset).toHaveBeenCalledTimes(1)
    expect(resume).toHaveBeenCalledTimes(1)
    expect(forceSnapshotFallback).toHaveBeenCalledWith(
      canvas.getContext('2d'),
      'visibility_rebaseline'
    )

    recorder.stop()
    canvas.remove()
  })

  it('should retry a rejected visibility rebaseline after commands resume', async () => {
    var microtasks = []
    var timers = []
    var currentTime = 0
    var canvas = document.createElement('canvas')
    document.body.appendChild(canvas)
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValues(
        Promise.resolve({ ok: false, reason: 'record_rejected' }),
        Promise.resolve({ ok: true })
      )
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoFailureBackoff: 1000
      }),
      emit: jasmine.createSpy('emit'),
      getCanvases: function () {
        return [canvas]
      },
      getSerializedNodeId: function () {
        return 43
      },
      snapshotCanvas: snapshotCanvas,
      now: function () {
        return currentTime
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      setTimeoutImpl: function (callback, delay) {
        timers.push({ callback: callback, delay: delay })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })
    canvas.getContext('2d')

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(1)
    expect(snapshotCanvas.calls.mostRecent().args[1]).toEqual(
      jasmine.objectContaining({
        reason: 'visibility_rebaseline',
        force: true
      })
    )
    expect(timers.length).toBe(1)
    expect(timers[0].delay).toBe(1000)

    currentTime = 1000
    timers[0].callback()
    while (microtasks.length) {
      microtasks.shift()()
    }
    await waitForAsyncSnapshotDebug()

    expect(snapshotCanvas).toHaveBeenCalledTimes(2)

    recorder.stop()
    canvas.remove()
  })

  it('should cap rejected visibility retries and continue with the next page', async () => {
    var microtasks = []
    var timers = []
    var currentTime = 0
    var scanStarted = false
    var scanPage = 0
    var firstCanvas = document.createElement('canvas')
    var secondCanvas = document.createElement('canvas')
    var onDebug = jasmine.createSpy('onDebug')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.callFake(function (canvas) {
        return Promise.resolve(
          canvas === firstCanvas
            ? { ok: false, reason: 'record_rejected' }
            : { ok: true }
        )
      })
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration({
        replayCanvasAutoFailureBackoff: 100
      }),
      emit: jasmine.createSpy('emit'),
      snapshotCanvas: snapshotCanvas,
      onDebug: onDebug,
      getCanvases: function () {
        if (!scanStarted) {
          return []
        }
        scanPage += 1
        if (scanPage === 1) {
          return [firstCanvas]
        }
        if (scanPage === 2) {
          return [secondCanvas]
        }
        return [firstCanvas]
      },
      getSerializedNodeId: function (canvas) {
        return canvas === firstCanvas ? 440 : 441
      },
      now: function () {
        return currentTime
      },
      scheduleMicrotask: function (callback) {
        microtasks.push(callback)
      },
      setTimeoutImpl: function (callback, delay) {
        timers.push({ callback: callback, delay: delay })
        return timers.length
      },
      clearTimeoutImpl: jasmine.createSpy('clearTimeout')
    })
    firstCanvas.getContext('2d')
    secondCanvas.getContext('2d')

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    scanStarted = true
    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))

    for (var round = 0; round < 30 && snapshotCanvas.calls.count() < 4; round += 1) {
      while (microtasks.length) {
        microtasks.shift()()
      }
      await Promise.resolve()
      await Promise.resolve()
      await Promise.resolve()
      if (timers.length) {
        currentTime += 100
        timers.shift().callback()
      }
    }

    expect(
      snapshotCanvas.calls.allArgs().filter(function (args) {
        return args[0] === firstCanvas
      }).length
    ).toBe(3)
    expect(snapshotCanvas).toHaveBeenCalledWith(
      secondCanvas,
      jasmine.objectContaining({ reason: 'visibility_rebaseline' })
    )
    expect(onDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        status: 'completed',
        results: [
          jasmine.objectContaining({
            reason: 'record_rejected_retry_exhausted'
          })
        ]
      })
    )
    recorder.stop()
  })

  it('should pause when visibilityState becomes hidden', () => {
    var pause = jasmine.createSpy('pause')
    var originalVisibilityStateDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'visibilityState'
    )
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop'),
        pause: pause,
        resume: jasmine.createSpy('resume')
      }
    })

    spyOnProperty(document, 'hidden', 'get').and.returnValue(undefined)
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: function () {
        return 'hidden'
      }
    })

    try {
      document.dispatchEvent(new Event('visibilitychange'))
      expect(pause).toHaveBeenCalledTimes(1)
    } finally {
      if (originalVisibilityStateDescriptor) {
        Object.defineProperty(document, 'visibilityState', originalVisibilityStateDescriptor)
      } else {
        delete document.visibilityState
      }
      recorder.stop()
    }
  })
})
