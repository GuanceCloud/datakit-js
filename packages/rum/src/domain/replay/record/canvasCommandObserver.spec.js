import { IncrementalSource, RecordType } from '../../../types'
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
      onMutationDebug: onMutationDebug
    })
    var canvas = document.createElement('canvas')
    canvas.__sn = { id: 7 }
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recorder.reset()

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
      onMutationDebug: onMutationDebug
    })
    var context = canvas.getContext('2d')

    context.fillRect(1, 2, 3, 4)
    recorder.reset()

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

  it('should capture commands from a 2d context created before the observer starts', () => {
    var onMutationDebug = jasmine.createSpy('onMutationDebug')
    var emit = jasmine.createSpy('emit')
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
      onMutationDebug: onMutationDebug
    })

    existingContext.fillRect(1, 2, 3, 4)
    recorder.reset()

    expect(onMutationDebug).toHaveBeenCalledWith(
      jasmine.objectContaining({
        canvasId: 71,
        commandCount: 1
      })
    )
    expect(emit).toHaveBeenCalledWith(
      jasmine.objectContaining({
        data: jasmine.objectContaining({
          id: 71
        })
      })
    )
    recorder.stop()
  })

  it('should expose a scanExistingCanvases hook for known 2d canvases discovered later', async () => {
    var patchContext = jasmine.createSpy('patchContext')
    var patchSharedPrototype = jasmine.createSpy('patchSharedPrototype')
    var snapshotCanvas = jasmine
      .createSpy('snapshotCanvas')
      .and.returnValue(Promise.resolve({ ok: true }))
    var onDebug = jasmine.createSpy('onDebug')
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

  it('should restore original getContext on stop', () => {
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit')
    })

    expect(HTMLCanvasElement.prototype.getContext).not.toBe(originalGetContext)

    recorder.stop()

    expect(HTMLCanvasElement.prototype.getContext).toBe(originalGetContext)
  })

  it('should pause on hidden and resume on visible', () => {
    var pause = jasmine.createSpy('pause')
    var resume = jasmine.createSpy('resume')
    var recorder = startCanvasCommandCapture({
      configuration: createConfiguration(),
      emit: jasmine.createSpy('emit'),
      commandRecorder: {
        patchContext: jasmine.createSpy('patchContext'),
        flush: jasmine.createSpy('flush'),
        stop: jasmine.createSpy('stop'),
        pause: pause,
        resume: resume
      }
    })

    var hiddenSpy = spyOnProperty(document, 'hidden', 'get')
    hiddenSpy.and.returnValue(true)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(pause).toHaveBeenCalledTimes(1)

    hiddenSpy.and.returnValue(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(resume).toHaveBeenCalledTimes(1)

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
