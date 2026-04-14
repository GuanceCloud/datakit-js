import { createCanvas2DCommandRecorder } from './canvasCommandCapture'

function shouldEnableCanvasCommandCapture(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto' &&
    configuration.replayCanvasSampling === 'all'
  )
}

function isDocumentHidden() {
  return (
    document.visibilityState === 'hidden' ||
    document.hidden === true
  )
}

export function startCanvasCommandCapture(options) {
  var configuration = options.configuration
  if (
    !shouldEnableCanvasCommandCapture(configuration) ||
    !window.HTMLCanvasElement ||
    !window.HTMLCanvasElement.prototype
  ) {
    return {
      stop: function () {},
      reset: function () {}
    }
  }

  var emit = options.emit
  var now = options.now || Date.now
  var onDebug = options.onDebug || function () {}
  var onMutationDebug = options.onMutationDebug || function () {}
  var snapshotCanvas = options.snapshotCanvas || function () {}
  var getCanvases =
    options.getCanvases ||
    function () {
      if (!document.querySelectorAll) {
        return []
      }
      return Array.prototype.slice.call(document.querySelectorAll('canvas'))
    }
  var getSerializedNodeId =
    options.getSerializedNodeId ||
    function (canvas) {
      return canvas && canvas.__sn && canvas.__sn.id
    }
  var known2dContextsByCanvas = new WeakMap()
  var initialSnapshotCanvases = new WeakSet()
  var queuedInitialSnapshotCanvases = new WeakSet()
  var pendingInitialSnapshotCanvases = []
  var runningInitialSnapshotCanvas
  var generation = 0
  var stopped = false
  var recorder =
    options.commandRecorder ||
    createCanvas2DCommandRecorder({
      shouldRecordContext: function (context) {
        return (
          context &&
          context.canvas &&
          (!configuration.shouldRecordCanvas ||
            configuration.shouldRecordCanvas(context.canvas) !== false)
        )
      },
      getCanvasId: function (context) {
        return context && context.canvas
          ? getSerializedNodeId(context.canvas)
          : undefined
      },
      requestSnapshotFallback: function (context, reason) {
        if (!context || !context.canvas) {
          return
        }
        var timestamp = now()
        var canvasId = getSerializedNodeId(context.canvas)
        onDebug({
          scheduler: 'command_capture',
          status: 'fallback',
          startedAt: timestamp,
          completedAt: timestamp,
          timestamp: timestamp,
          eligibleCanvasCount: 1,
          selectedCanvasCount: 0,
          skippedBudgetCount: 0,
          keepSessionAliveTriggered: false,
          results: [
            {
              canvasId: canvasId,
              ok: false,
              reason: reason,
              priority: undefined
            }
          ]
        })
        snapshotCanvas(context.canvas, {
          trigger: 'auto',
          scheduler: 'command_capture',
          reason: reason
        })
      },
      emit: function (event) {
        var completedAt =
          typeof event.completedAt === 'number'
            ? event.completedAt
            : typeof event.timestamp === 'number'
              ? event.timestamp
              : now()
        var startedAt =
          typeof event.startedAt === 'number' ? event.startedAt : completedAt
        var approxBytes = JSON.stringify(event.data && event.data.commands || []).length
        onMutationDebug({
          timestamp: completedAt,
          canvasId: event.data && event.data.id,
          trigger: 'auto',
          approxBytesCount: approxBytes,
          commandCount:
            event.data && event.data.commands ? event.data.commands.length : 0
        })
        onDebug({
          scheduler: 'command_capture',
          status: 'completed',
          startedAt: startedAt,
          completedAt: completedAt,
          timestamp: completedAt,
          eligibleCanvasCount: 1,
          selectedCanvasCount: 1,
          skippedBudgetCount: 0,
          keepSessionAliveTriggered: false,
          results: [
            {
              canvasId: event.data && event.data.id,
              ok: true,
              reason: undefined,
              priority: undefined
            }
          ]
        })
        emit(event)
      }
    })
  var originalGetContext = window.HTMLCanvasElement.prototype.getContext
  var removeVisibilityListener = function () {}

  if (typeof originalGetContext !== 'function') {
    return {
      stop: function () {},
      reset: function () {}
    }
  }

  function patchExistingCanvases() {
    getCanvases().forEach(function (canvas) {
      if (
        stopped ||
        !canvas ||
        (configuration.shouldRecordCanvas &&
          configuration.shouldRecordCanvas(canvas) === false)
      ) {
        return
      }
      var context = known2dContextsByCanvas.get(canvas)
      if (context) {
        recorder.patchContext(context)
      }
      if (
        getSerializedNodeId(canvas) !== undefined &&
        getSerializedNodeId(canvas) !== null &&
        getSerializedNodeId(canvas) !== -1 &&
        !initialSnapshotCanvases.has(canvas) &&
        !queuedInitialSnapshotCanvases.has(canvas) &&
        context
      ) {
        queuedInitialSnapshotCanvases.add(canvas)
        pendingInitialSnapshotCanvases.push(canvas)
      }
    })
    runNextInitialSnapshot()
  }

  function runNextInitialSnapshot() {
    if (stopped || runningInitialSnapshotCanvas || !pendingInitialSnapshotCanvases.length) {
      return
    }

    var canvas = pendingInitialSnapshotCanvases.shift()
    if (!canvas) {
      return
    }

    var canvasId = getSerializedNodeId(canvas)
    if (
      !canvasId &&
      canvasId !== 0
    ) {
      runNextInitialSnapshot()
      return
    }

    if (
      initialSnapshotCanvases.has(canvas) ||
      (configuration.shouldRecordCanvas &&
        configuration.shouldRecordCanvas(canvas) === false)
    ) {
      runNextInitialSnapshot()
      return
    }

    var startedAt = now()
    var snapshotGeneration = generation
    runningInitialSnapshotCanvas = canvas
    initialSnapshotCanvases.add(canvas)
    Promise.resolve()
      .then(function () {
        return snapshotCanvas(canvas, {
          trigger: 'auto',
          scheduler: 'command_capture',
          reason: 'initial_static_canvas'
        })
      })
      .then(function (result) {
        if (stopped || snapshotGeneration !== generation) {
          return
        }
        var completedAt = now()
        if (!result || result.ok === false) {
          initialSnapshotCanvases.delete(canvas)
        }
        onDebug({
          scheduler: 'command_capture',
          status: 'completed',
          startedAt: startedAt,
          completedAt: completedAt,
          timestamp: completedAt,
          eligibleCanvasCount: 1,
          selectedCanvasCount:
            result && result.ok === false ? 0 : 1,
          skippedBudgetCount: 0,
          keepSessionAliveTriggered: false,
          results: [
            {
              canvasId: canvasId,
              ok: !(result && result.ok === false),
              reason: result && result.ok === false ? result.reason : undefined,
              priority: undefined
            }
          ]
        })
      })
      .catch(function () {
        if (stopped || snapshotGeneration !== generation) {
          return
        }
        var completedAt = now()
        initialSnapshotCanvases.delete(canvas)
        onDebug({
          scheduler: 'command_capture',
          status: 'completed',
          startedAt: startedAt,
          completedAt: completedAt,
          timestamp: completedAt,
          eligibleCanvasCount: 1,
          selectedCanvasCount: 0,
          skippedBudgetCount: 0,
          keepSessionAliveTriggered: false,
          results: [
            {
              canvasId: canvasId,
              ok: false,
              reason: 'snapshot_failed',
              priority: undefined
            }
          ]
        })
      })
      .finally(function () {
        queuedInitialSnapshotCanvases.delete(canvas)
        if (runningInitialSnapshotCanvas === canvas) {
          runningInitialSnapshotCanvas = undefined
        }
        runNextInitialSnapshot()
      })
  }

  if (
    recorder.patchSharedPrototype &&
    window.CanvasRenderingContext2D &&
    window.CanvasRenderingContext2D.prototype
  ) {
    recorder.patchSharedPrototype(window.CanvasRenderingContext2D.prototype)
  }

  window.HTMLCanvasElement.prototype.getContext = function (contextType) {
    var context = originalGetContext.apply(this, arguments)
    if (
      contextType === '2d' &&
      context &&
      (!configuration.shouldRecordCanvas ||
        configuration.shouldRecordCanvas(this) !== false)
    ) {
      known2dContextsByCanvas.set(this, context)
      recorder.patchContext(context)
    }
    return context
  }

  patchExistingCanvases()

  if (document.addEventListener && document.removeEventListener) {
    var onVisibilityChange = function () {
      if (isDocumentHidden()) {
        if (recorder.pause) {
          recorder.pause()
        }
        return
      }
      if (recorder.resume) {
        recorder.resume()
      }
      patchExistingCanvases()
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    removeVisibilityListener = function () {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  return {
    stop: function () {
      stopped = true
      generation += 1
      pendingInitialSnapshotCanvases = []
      queuedInitialSnapshotCanvases = new WeakSet()
      runningInitialSnapshotCanvas = undefined
      window.HTMLCanvasElement.prototype.getContext = originalGetContext
      removeVisibilityListener()
      recorder.stop()
    },
    reset: function () {
      generation += 1
      initialSnapshotCanvases = new WeakSet()
      queuedInitialSnapshotCanvases = new WeakSet()
      pendingInitialSnapshotCanvases = []
      runningInitialSnapshotCanvas = undefined
      recorder.flush()
      if (recorder.reset) {
        recorder.reset()
      }
    },
    scanExistingCanvases: function () {
      patchExistingCanvases()
    }
  }
}
