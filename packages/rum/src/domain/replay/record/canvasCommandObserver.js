import { createCanvas2DCommandRecorder } from './canvasCommandCapture'
import {
  getReplayCanvasRecordingDecision,
  getReplayCanvasContextType,
  isReplayInternalCanvas,
  ReplayCanvasContextType,
  setReplayCanvasContextType
} from './canvasContext'

var COMMAND_FALLBACK_MIN_COOLDOWN = 120
var MAX_COMMAND_FALLBACK_SNAPSHOTS_PER_RUN = 8
var MAX_COMMAND_FALLBACK_CONCURRENCY = 4
var MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE = 64
var MAX_COMMAND_CANVAS_SCAN_PAGES = 32
var MAX_COMMAND_RECORD_REJECTED_RETRIES = 3
var MAX_COMMAND_NOT_SERIALIZED_RETRIES = 8
var MAX_COMMAND_FALLBACK_TIMERS = 64
var MAX_COMMAND_FALLBACK_TIMER_DELAY = 60000

function clampInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), minimum), maximum)
}

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
  var defaultCanvasScanOffset = 0
  var getCanvases =
    options.getCanvases ||
    function (maxScanCount) {
      if (!document.querySelectorAll) {
        return []
      }
      var canvases = document.querySelectorAll('canvas')
      if (
        typeof maxScanCount !== 'number' ||
        !isFinite(maxScanCount)
      ) {
        return Array.prototype.slice.call(canvases)
      }
      var scanCount = Math.max(Math.floor(maxScanCount), 0)
      if (!scanCount || !canvases.length) {
        defaultCanvasScanOffset = 0
        return []
      }
      if (defaultCanvasScanOffset >= canvases.length) {
        defaultCanvasScanOffset = 0
      }
      var batch = []
      var scanEnd = Math.min(
        defaultCanvasScanOffset + scanCount,
        canvases.length
      )
      for (
        var canvasIndex = defaultCanvasScanOffset;
        canvasIndex < scanEnd;
        canvasIndex += 1
      ) {
        batch.push(canvases[canvasIndex])
      }
      defaultCanvasScanOffset += batch.length
      if (defaultCanvasScanOffset >= canvases.length) {
        defaultCanvasScanOffset = 0
      }
      return batch
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
  var pendingInitialSnapshotHead = 0
  var runningInitialSnapshotCanvas
  var runningInitialSnapshotToken
  var shouldContinueInitialSnapshotScan = false
  var initialSnapshotScanSeenCanvases = new WeakSet()
  var initialSnapshotScanPageCount = 0
  var canvasMutationGenerationByCanvas = new WeakMap()
  var snapshotBaselineMutationGenerationByCanvas = new WeakMap()
  var generation = 0
  var fallbackGeneration = 0
  var stopped = false
  var waitingForSnapshotBaseline = options.startPaused === true
  var scheduleMicrotask =
    options.scheduleMicrotask ||
    function (callback) {
      Promise.resolve().then(callback)
    }
  var setTimeoutImpl =
    options.setTimeoutImpl ||
    function (callback, delay) {
      return setTimeout(callback, delay)
    }
  var clearTimeoutImpl =
    options.clearTimeoutImpl ||
    function (timeoutId) {
      clearTimeout(timeoutId)
    }
  var fallbackStateByCanvas = new WeakMap()
  var fallbackQueue = []
  var fallbackQueueHead = 0
  var fallbackRetryQueue = []
  var fallbackRetryQueueHead = 0
  var fallbackQueueScheduled = false
  var activeFallbackSnapshotCount = 0
  var fallbackTimerStates = new Set()
  var visibilityScanContinuationPending = false
  var visibilityScanContinuationGeneration = 0
  var visibilityScanContinuationScheduled = false
  var fallbackCanvasWeakRefFactory = Object.prototype.hasOwnProperty.call(
    options,
    'weakRefFactory'
  )
    ? typeof options.weakRefFactory === 'function'
      ? options.weakRefFactory
      : undefined
    : typeof WeakRef === 'function'
      ? function (canvas) {
        return new WeakRef(canvas)
      }
      : undefined
  var maxFallbackTimerCount = clampInteger(
    options.maxFallbackTimerCount,
    MAX_COMMAND_FALLBACK_TIMERS,
    1,
    MAX_COMMAND_FALLBACK_TIMERS
  )
  var maxFallbackTimerDelay = clampInteger(
    options.maxFallbackTimerDelay,
    MAX_COMMAND_FALLBACK_TIMER_DELAY,
    1,
    MAX_COMMAND_FALLBACK_TIMER_DELAY
  )
  var maxFallbackSnapshotsPerRun = clampInteger(
    configuration.replayCanvasAutoMaxPerRun,
    2,
    1,
    MAX_COMMAND_FALLBACK_SNAPSHOTS_PER_RUN
  )
  var maxActiveFallbackSnapshots = clampInteger(
    configuration.replayCanvasMaxConcurrentEncodes,
    1,
    1,
    Math.min(
      maxFallbackSnapshotsPerRun,
      MAX_COMMAND_FALLBACK_CONCURRENCY
    )
  )
  var maxQueuedFallbackSnapshots = Math.max(
    maxFallbackSnapshotsPerRun * 2,
    maxActiveFallbackSnapshots * 2,
    4
  )
  // One visibility page contains at most 64 canvases. Keep its active and
  // deferred fallback work inside a fixed 64-entry queue budget, then wait for
  // that page to drain before scanning the next one.
  var maxQueuedFallbackRetries = Math.max(
    MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE - maxQueuedFallbackSnapshots,
    0
  )

  function getFallbackCooldown(result) {
    if (!result || result.ok !== false) {
      return (
        configuration.replayCanvasAutoCooldown ||
        COMMAND_FALLBACK_MIN_COOLDOWN
      )
    }
    if (result.reason === 'unchanged' || result.reason === 'below_threshold') {
      return (
        configuration.replayCanvasAutoUnchangedBackoff ||
        configuration.replayCanvasAutoCooldown ||
        COMMAND_FALLBACK_MIN_COOLDOWN
      )
    }
    if (result.reason === 'not_serialized') {
      return COMMAND_FALLBACK_MIN_COOLDOWN
    }
    return (
      configuration.replayCanvasAutoFailureBackoff ||
      configuration.replayCanvasAutoCooldown ||
      COMMAND_FALLBACK_MIN_COOLDOWN
    )
  }

  function getFallbackState(canvas) {
    var state = fallbackStateByCanvas.get(canvas)
    if (!state) {
      state = {
        $rDirty: false,
        $rInFlight: false,
        $rQueued: false,
        retryQueued: false,
        consecutiveRecordRejectedCount: 0,
        $rLastRetryableFailureReason: undefined,
        nextEligibleAt: 0,
        $rReason: undefined,
        $rTimeoutId: undefined
      }
      fallbackStateByCanvas.set(canvas, state)
    }
    return state
  }

  function clearFallbackTimer(state) {
    if (state.$rTimeoutId !== undefined) {
      clearTimeoutImpl(state.$rTimeoutId)
      state.$rTimeoutId = undefined
    }
    fallbackTimerStates.delete(state)
  }

  function getFallbackQueueSize() {
    return fallbackQueue.length - fallbackQueueHead
  }

  function getFallbackRetryQueueSize() {
    return fallbackRetryQueue.length - fallbackRetryQueueHead
  }

  function getFallbackWorkCount() {
    return (
      getFallbackQueueSize() +
      getFallbackRetryQueueSize() +
      fallbackTimerStates.size
    )
  }

  function dropFallbackState(state) {
    state.$rDirty = false
    state.$rReason = undefined
  }

  function dequeueFallback() {
    var queuedFallback = fallbackQueue[fallbackQueueHead]
    fallbackQueue[fallbackQueueHead] = undefined
    fallbackQueueHead += 1
    if (fallbackQueueHead === fallbackQueue.length) {
      fallbackQueue = []
      fallbackQueueHead = 0
    } else if (fallbackQueueHead >= maxQueuedFallbackSnapshots) {
      fallbackQueue = fallbackQueue.slice(fallbackQueueHead)
      fallbackQueueHead = 0
    }
    return queuedFallback
  }

  function dequeueFallbackRetry() {
    var retryFallback = fallbackRetryQueue[fallbackRetryQueueHead]
    fallbackRetryQueue[fallbackRetryQueueHead] = undefined
    fallbackRetryQueueHead += 1
    if (fallbackRetryQueueHead === fallbackRetryQueue.length) {
      fallbackRetryQueue = []
      fallbackRetryQueueHead = 0
    } else if (fallbackRetryQueueHead >= maxQueuedFallbackRetries) {
      fallbackRetryQueue = fallbackRetryQueue.slice(
        fallbackRetryQueueHead
      )
      fallbackRetryQueueHead = 0
    }
    return retryFallback
  }

  function getPendingInitialSnapshotCount() {
    return pendingInitialSnapshotCanvases.length - pendingInitialSnapshotHead
  }

  function dequeueInitialSnapshotCanvas() {
    var canvas = pendingInitialSnapshotCanvases[pendingInitialSnapshotHead]
    pendingInitialSnapshotCanvases[pendingInitialSnapshotHead] = undefined
    pendingInitialSnapshotHead += 1
    if (pendingInitialSnapshotHead === pendingInitialSnapshotCanvases.length) {
      pendingInitialSnapshotCanvases = []
      pendingInitialSnapshotHead = 0
    } else if (
      pendingInitialSnapshotHead >= MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
    ) {
      pendingInitialSnapshotCanvases = pendingInitialSnapshotCanvases.slice(
        pendingInitialSnapshotHead
      )
      pendingInitialSnapshotHead = 0
    }
    return canvas
  }

  function notifyFallbackSnapshot(
    canvas,
    status,
    startedAt,
    completedAt,
    result,
    fallbackReason
  ) {
    onDebug({
      scheduler: 'command_capture',
      status: status,
      startedAt: startedAt,
      completedAt: completedAt,
      timestamp: completedAt,
      eligibleCanvasCount: 1,
      selectedCanvasCount:
        status === 'completed' && (!result || result.ok !== false) ? 1 : 0,
      skippedBudgetCount: 0,
      keepSessionAliveTriggered: false,
      results: [
        {
          canvasId: getSerializedNodeId(canvas),
          ok: status === 'completed' && (!result || result.ok !== false),
          reason:
            status === 'fallback'
              ? fallbackReason
              : result && result.ok === false
                ? result.reason
                : undefined,
          priority: undefined
        }
      ]
    })
  }

  function isFallbackPipelineIdle() {
    return (
      !fallbackQueueScheduled &&
      !getFallbackQueueSize() &&
      !getFallbackRetryQueueSize() &&
      !activeFallbackSnapshotCount &&
      !fallbackTimerStates.size
    )
  }

  function scheduleVisibilityScanContinuationIfReady() {
    if (
      stopped ||
      !visibilityScanContinuationPending ||
      visibilityScanContinuationScheduled ||
      visibilityScanContinuationGeneration !== generation ||
      isDocumentHidden() ||
      !isFallbackPipelineIdle()
    ) {
      return
    }
    visibilityScanContinuationScheduled = true
    var scanGeneration = generation
    scheduleMicrotask(function () {
      if (
        stopped ||
        scanGeneration !== generation ||
        scanGeneration !== visibilityScanContinuationGeneration
      ) {
        return
      }
      visibilityScanContinuationScheduled = false
      if (isDocumentHidden() || !isFallbackPipelineIdle()) {
        return
      }
      visibilityScanContinuationPending = false
      patchExistingCanvases(true, true)
    })
  }

  function scheduleFallbackQueueDrain() {
    if (
      stopped ||
      fallbackQueueScheduled ||
      !getFallbackQueueSize() ||
      activeFallbackSnapshotCount >= maxActiveFallbackSnapshots
    ) {
      scheduleVisibilityScanContinuationIfReady()
      return
    }
    fallbackQueueScheduled = true
    var scheduledGeneration = fallbackGeneration
    scheduleMicrotask(function () {
      if (scheduledGeneration !== fallbackGeneration) {
        return
      }
      fallbackQueueScheduled = false
      drainFallbackQueue()
    })
  }

  function enqueueFallbackSnapshot(canvas, state) {
    if (
      stopped ||
      state.$rQueued ||
      state.retryQueued ||
      state.$rInFlight ||
      state.$rTimeoutId !== undefined
    ) {
      return
    }
    if (
      getFallbackWorkCount() >=
      MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
    ) {
      dropFallbackState(state)
      return
    }
    if (getFallbackQueueSize() >= maxQueuedFallbackSnapshots) {
      enqueueFallbackRetry(canvas, state)
      scheduleFallbackQueueDrain()
      return
    }
    state.$rQueued = true
    fallbackQueue.push({
      canvas: canvas,
      state: state,
      generation: fallbackGeneration
    })
    scheduleFallbackQueueDrain()
  }

  function enqueueFallbackRetry(canvas, state) {
    if (
      stopped ||
      state.retryQueued ||
      state.$rQueued ||
      state.$rInFlight ||
      state.$rTimeoutId !== undefined
    ) {
      return
    }
    if (
      getFallbackRetryQueueSize() >= maxQueuedFallbackRetries ||
      getFallbackWorkCount() >=
        MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
    ) {
      dropFallbackState(state)
      return
    }
    state.retryQueued = true
    fallbackRetryQueue.push({
      canvas: canvas,
      state: state,
      generation: fallbackGeneration
    })
  }

  function promoteFallbackRetries() {
    var retryInspectionCount = getFallbackRetryQueueSize()
    while (
      !stopped &&
      getFallbackQueueSize() < maxQueuedFallbackSnapshots &&
      getFallbackRetryQueueSize() &&
      retryInspectionCount > 0
    ) {
      var retryFallback = dequeueFallbackRetry()
      retryInspectionCount -= 1
      var state = retryFallback.state
      state.retryQueued = false
      if (
        retryFallback.generation !== fallbackGeneration ||
        !state.$rDirty ||
        state.$rQueued ||
        state.$rInFlight ||
        state.$rTimeoutId !== undefined
      ) {
        continue
      }
      if (
        now() < state.nextEligibleAt &&
        fallbackTimerStates.size >= maxFallbackTimerCount
      ) {
        enqueueFallbackRetry(retryFallback.canvas, state)
        continue
      }
      state.$rQueued = true
      fallbackQueue.push(retryFallback)
    }
  }

  function scheduleFallbackSnapshotWhenEligible(canvas, state) {
    if (
      stopped ||
      state.$rQueued ||
      state.retryQueued ||
      state.$rInFlight ||
      state.$rTimeoutId !== undefined
    ) {
      return
    }
    var delay = Math.max(state.nextEligibleAt - now(), 0)
    if (!delay) {
      enqueueFallbackSnapshot(canvas, state)
      return
    }
    if (
      getFallbackWorkCount() >=
      MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
    ) {
      dropFallbackState(state)
      return
    }
    if (fallbackTimerStates.size >= maxFallbackTimerCount) {
      enqueueFallbackRetry(canvas, state)
      return
    }
    var canvasRef
    try {
      canvasRef = fallbackCanvasWeakRefFactory
        ? fallbackCanvasWeakRefFactory(canvas)
        : {
            // WeakRef is unavailable in older browsers. The timer count and
            // delay are both bounded, so retaining this canvas briefly is
            // preferable to losing the final dirty frame forever.
            deref: function () {
              return canvas
            }
          }
    } catch (_) {}
    if (!canvasRef || typeof canvasRef.deref !== 'function') {
      // WeakRef construction is not guaranteed just because the global exists.
      // The fallback timer count and delay are bounded, so use the same bounded
      // strong-reference path rather than losing a static tail frame.
      canvasRef = {
        deref: function () {
          return canvas
        }
      }
    }
    var scheduledGeneration = fallbackGeneration
    try {
      state.$rTimeoutId = setTimeoutImpl(function () {
        state.$rTimeoutId = undefined
        fallbackTimerStates.delete(state)
        if (
          stopped ||
          scheduledGeneration !== fallbackGeneration
        ) {
          return
        }
        if (!state.$rDirty) {
          promoteFallbackRetries()
          scheduleFallbackQueueDrain()
          scheduleVisibilityScanContinuationIfReady()
          return
        }
        var referencedCanvas = canvasRef.deref()
        if (!referencedCanvas) {
          state.$rDirty = false
          promoteFallbackRetries()
          scheduleFallbackQueueDrain()
          scheduleVisibilityScanContinuationIfReady()
          return
        }
        enqueueFallbackSnapshot(referencedCanvas, state)
        promoteFallbackRetries()
        scheduleFallbackQueueDrain()
        scheduleVisibilityScanContinuationIfReady()
      }, Math.min(delay, maxFallbackTimerDelay))
    } catch (_) {
      state.$rTimeoutId = undefined
      return
    }
    fallbackTimerStates.add(state)
  }

  function runFallbackSnapshot(canvas, state, scheduledGeneration) {
    if (
      stopped ||
      scheduledGeneration !== fallbackGeneration ||
      isDocumentHidden() ||
      !state.$rDirty
    ) {
      return
    }

    var startedAt = now()
    var fallbackReason = state.$rReason || 'unsupported_canvas_object'
    state.$rDirty = false
    state.$rInFlight = true
    activeFallbackSnapshotCount += 1
    notifyFallbackSnapshot(
      canvas,
      'fallback',
      startedAt,
      startedAt,
      undefined,
      fallbackReason
    )

    Promise.resolve()
      .then(function () {
        return snapshotCanvas(canvas, {
          trigger: 'auto',
          scheduler: 'command_capture',
          reason: fallbackReason,
          force: true
        })
      })
      .catch(function () {
        return {
          ok: false,
          reason: 'snapshot_failed'
        }
      })
      .then(function (result) {
        if (stopped || scheduledGeneration !== fallbackGeneration) {
          return
        }
        var completedAt = now()
        var isRetryableFailure =
          result &&
          result.ok === false &&
          (result.reason === 'record_rejected' ||
            result.reason === 'not_serialized')
        if (isRetryableFailure) {
          // Segment admission and DOM publication can both lag behind the draw
          // that triggered this bitmap. Keep the final visual state dirty for a
          // bounded retry so a canvas that becomes static is not lost forever.
          // Permanent capture failures still wait for a later draw.
          if (
            state.$rLastRetryableFailureReason !== result.reason
          ) {
            state.consecutiveRecordRejectedCount = 0
            state.$rLastRetryableFailureReason = result.reason
          }
          var maxRetryCount =
            result.reason === 'not_serialized'
              ? MAX_COMMAND_NOT_SERIALIZED_RETRIES
              : MAX_COMMAND_RECORD_REJECTED_RETRIES
          state.consecutiveRecordRejectedCount += 1
          state.$rDirty =
            state.consecutiveRecordRejectedCount <
            maxRetryCount
        } else {
          state.consecutiveRecordRejectedCount = 0
          state.$rLastRetryableFailureReason = undefined
        }
        state.nextEligibleAt = completedAt + getFallbackCooldown(result)
        var debugResult = result
        if (
          result &&
          result.ok === false &&
          isRetryableFailure &&
          state.consecutiveRecordRejectedCount >=
            maxRetryCount
        ) {
          state.$rReason = undefined
          debugResult = {
            ok: false,
            reason: result.reason + '_retry_exhausted'
          }
        }
        notifyFallbackSnapshot(
          canvas,
          'completed',
          startedAt,
          completedAt,
          debugResult,
          fallbackReason
        )
      })
      .finally(function () {
        state.$rInFlight = false
        activeFallbackSnapshotCount = Math.max(
          activeFallbackSnapshotCount - 1,
          0
        )
        if (
          !stopped &&
          scheduledGeneration === fallbackGeneration &&
          state.$rDirty
        ) {
          scheduleFallbackSnapshotWhenEligible(canvas, state)
        }
        scheduleFallbackQueueDrain()
        scheduleVisibilityScanContinuationIfReady()
      })
  }

  function drainFallbackQueue() {
    if (stopped || isDocumentHidden()) {
      return
    }
    promoteFallbackRetries()
    while (
      activeFallbackSnapshotCount < maxActiveFallbackSnapshots &&
      getFallbackQueueSize()
    ) {
      var queuedFallback = dequeueFallback()
      var state = queuedFallback.state
      state.$rQueued = false
      promoteFallbackRetries()
      if (
        queuedFallback.generation !== fallbackGeneration ||
        !state.$rDirty
      ) {
        continue
      }
      if (now() < state.nextEligibleAt) {
        scheduleFallbackSnapshotWhenEligible(queuedFallback.canvas, state)
        continue
      }
      runFallbackSnapshot(
        queuedFallback.canvas,
        state,
        queuedFallback.generation
      )
    }
    promoteFallbackRetries()
    scheduleFallbackQueueDrain()
    scheduleVisibilityScanContinuationIfReady()
  }

  function requestFallbackSnapshot(context, reason) {
    if (!context || !context.canvas || stopped || isDocumentHidden()) {
      return
    }
    var canvas = context.canvas
    var state = getFallbackState(canvas)
    state.consecutiveRecordRejectedCount = 0
    state.$rLastRetryableFailureReason = undefined
    state.$rDirty = true
    if (!state.$rReason) {
      state.$rReason = reason || 'unsupported_canvas_object'
    }
    if (
      state.$rInFlight ||
      state.$rQueued ||
      state.retryQueued ||
      state.$rTimeoutId !== undefined
    ) {
      return
    }
    if (now() < state.nextEligibleAt) {
      scheduleFallbackSnapshotWhenEligible(canvas, state)
      return
    }
    enqueueFallbackSnapshot(canvas, state)
  }

  function retryPublishedCanvas(canvas) {
    if (stopped || !canvas) {
      return
    }
    var state = fallbackStateByCanvas.get(canvas)
    if (
      !state ||
      state.$rLastRetryableFailureReason !== 'not_serialized'
    ) {
      return
    }
    // DOM mutation admission can remain backpressured longer than the polling
    // retry window. Publication is the authoritative signal that the bitmap
    // can now reference this canvas id, so retry immediately without requiring
    // another business draw.
    clearFallbackTimer(state)
    state.consecutiveRecordRejectedCount = 0
    state.$rLastRetryableFailureReason = undefined
    state.nextEligibleAt = now()
    state.$rDirty = true
    enqueueFallbackSnapshot(canvas, state)
  }

  function resetFallbackSnapshots() {
    fallbackGeneration += 1
    fallbackQueue = []
    fallbackQueueHead = 0
    fallbackRetryQueue = []
    fallbackRetryQueueHead = 0
    fallbackQueueScheduled = false
    visibilityScanContinuationPending = false
    visibilityScanContinuationScheduled = false
    visibilityScanContinuationGeneration = generation
    fallbackTimerStates.forEach(function (state) {
      clearFallbackTimer(state)
    })
    fallbackTimerStates.clear()
    fallbackStateByCanvas = new WeakMap()
  }

  var recorder =
    options.commandRecorder ||
    createCanvas2DCommandRecorder({
      shouldRecordContext: function (context) {
        return (
          context &&
          context.canvas &&
          !isReplayInternalCanvas(context.canvas) &&
          getReplayCanvasRecordingDecision(
            configuration,
            context.canvas
          ) !== false
        )
      },
      getCanvasId: function (context) {
        return context && context.canvas
          ? getSerializedNodeId(context.canvas)
          : undefined
      },
      onContextDiscovered: function (context) {
        if (context && context.canvas) {
          setReplayCanvasContextType(
            context.canvas,
            ReplayCanvasContextType.Canvas2D
          )
          known2dContextsByCanvas.set(context.canvas, context)
          return initialSnapshotCanvases.has(context.canvas)
        }
      },
      onContextMutation: function (context) {
        if (context && context.canvas) {
          markCanvasMutation(context.canvas)
        }
      },
      requestAnimationFrameImpl: options.requestAnimationFrameImpl,
      cancelAnimationFrameImpl: options.cancelAnimationFrameImpl,
      requestSnapshotFallback: requestFallbackSnapshot,
      onCommandOverflow: function (overflow) {
        onMutationDebug({
          timestamp: now(),
          canvasId:
            overflow.context && overflow.context.canvas
              ? getSerializedNodeId(overflow.context.canvas)
              : undefined,
          trigger: 'auto',
          reason: overflow.reason,
          approxBytesCount: overflow.pendingApproxBytes,
          commandCount: 0,
          pendingContextCount: overflow.pendingContextCount
        })
      },
      emit: function (event, metadata) {
        var completedAt =
          typeof event.completedAt === 'number'
            ? event.completedAt
            : typeof event.timestamp === 'number'
              ? event.timestamp
              : now()
        var startedAt =
          typeof event.startedAt === 'number' ? event.startedAt : completedAt
        var commands =
          event.data && event.data.commands ? event.data.commands : []
        var approxBytes =
          metadata && typeof metadata.approxBytesCount === 'number'
            ? metadata.approxBytesCount
            : JSON.stringify(commands).length
        var commandCount =
          metadata && typeof metadata.commandCount === 'number'
            ? metadata.commandCount
            : commands.length
        var recordAccepted = emit(event)
        var mutationDebug = {
          timestamp: completedAt,
          canvasId: event.data && event.data.id,
          trigger: 'auto',
          approxBytesCount: approxBytes,
          commandCount: commandCount
        }
        if (recordAccepted === false) {
          mutationDebug.reason = 'command_record_rejected'
        }
        onMutationDebug(mutationDebug)
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
              ok: recordAccepted !== false,
              reason:
                recordAccepted === false
                  ? 'command_record_rejected'
                  : undefined,
              priority: undefined
            }
          ]
        })
        return recordAccepted
      }
    })
  var canvasPrototype = window.HTMLCanvasElement.prototype
  var originalGetContext = canvasPrototype.getContext
  var removeVisibilityListener = function () {}
  var restoreCanvasDimensionSetters = []

  if (waitingForSnapshotBaseline && recorder.pause) {
    recorder.pause()
  }

  if (typeof originalGetContext !== 'function') {
    return {
      stop: function () {},
      reset: function () {}
    }
  }

  function patchCanvasDimensionSetter(propertyName) {
    var descriptor = Object.getOwnPropertyDescriptor(
      canvasPrototype,
      propertyName
    )
    if (
      !descriptor ||
      descriptor.configurable === false ||
      typeof descriptor.set !== 'function'
    ) {
      return
    }
    var originalSetter = descriptor.set
    var wrappedSetter = function () {
      var shouldTrackMutation =
        !stopped && !isReplayInternalCanvas(this)
      if (
        shouldTrackMutation &&
        (known2dContextsByCanvas.has(this) ||
          getReplayCanvasContextType(this) ===
            ReplayCanvasContextType.Canvas2D)
      ) {
        try {
          recorder.flush()
        } catch (_) {}
      }
      var result = originalSetter.apply(this, arguments)
      if (shouldTrackMutation) {
        markCanvasMutation(this)
      }
      return result
    }
    try {
      Object.defineProperty(
        canvasPrototype,
        propertyName,
        {
          configurable: descriptor.configurable,
          enumerable: descriptor.enumerable,
          get: descriptor.get,
          set: wrappedSetter
        }
      )
    } catch (_) {
      return
    }
    restoreCanvasDimensionSetters.push(function () {
      var currentDescriptor = Object.getOwnPropertyDescriptor(
        canvasPrototype,
        propertyName
      )
      if (currentDescriptor && currentDescriptor.set === wrappedSetter) {
        try {
          Object.defineProperty(
            canvasPrototype,
            propertyName,
            descriptor
          )
        } catch (_) {}
      }
    })
  }

  patchCanvasDimensionSetter('width')
  patchCanvasDimensionSetter('height')

  function markCanvasMutation(canvas) {
    canvasMutationGenerationByCanvas.set(
      canvas,
      (canvasMutationGenerationByCanvas.get(canvas) || 0) + 1
    )
  }

  function createCanvasSnapshotBaselineToken(canvas) {
    return {
      canvas: canvas,
      generation: generation,
      mutationGeneration:
        canvasMutationGenerationByCanvas.get(canvas) || 0
    }
  }

  function markCanvasSnapshotBaseline(canvas, token, reason) {
    if (
      stopped ||
      !canvas ||
      !token ||
      token.canvas !== canvas ||
      token.generation !== generation
    ) {
      return false
    }
    var mutatedDuringSnapshot =
      token.mutationGeneration !==
      (canvasMutationGenerationByCanvas.get(canvas) || 0)
    var context = known2dContextsByCanvas.get(canvas)
    if (mutatedDuringSnapshot && !context) {
      return false
    }
    initialSnapshotCanvases.add(canvas)
    snapshotBaselineMutationGenerationByCanvas.set(
      canvas,
      token.mutationGeneration
    )
    queuedInitialSnapshotCanvases.delete(canvas)
    if (
      mutatedDuringSnapshot &&
      context &&
      recorder.forceSnapshotFallback
    ) {
      recorder.forceSnapshotFallback(
        context,
        'bitmap_changed_during_snapshot'
      )
    }
    if (
      context &&
      recorder.markPersistentSnapshotFallback
    ) {
      recorder.markPersistentSnapshotFallback(
        context,
        reason || 'bitmap_snapshot_baseline'
      )
    }
    return true
  }

  function patchExistingCanvases(isContinuation, useFallbackScheduler) {
    if (!isContinuation) {
      initialSnapshotScanSeenCanvases = new WeakSet()
      initialSnapshotScanPageCount = 0
    }
    var foundUnseenCanvas = false
    var queueOverflow = false
    var canvases = getCanvases(MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE)
    initialSnapshotScanPageCount += 1
    canvases.forEach(function (canvas) {
      if (
        !canvas ||
        initialSnapshotScanSeenCanvases.has(canvas)
      ) {
        return
      }
      // Mark every returned canvas, including filtered or already baselined
      // ones. A rolling registry can wrap to the first page; eligibility-only
      // tracking would then rescan failed pages forever.
      initialSnapshotScanSeenCanvases.add(canvas)
      foundUnseenCanvas = true
      if (
        stopped ||
        getReplayCanvasRecordingDecision(configuration, canvas) === false
      ) {
        return
      }
      var context = known2dContextsByCanvas.get(canvas)
      if (context) {
        recorder.patchContext(context)
      }
      var baselineMutationGeneration =
        snapshotBaselineMutationGenerationByCanvas.get(canvas)
      var currentMutationGeneration =
        canvasMutationGenerationByCanvas.get(canvas) || 0
      if (
        context &&
        initialSnapshotCanvases.has(canvas) &&
        baselineMutationGeneration !== undefined &&
        baselineMutationGeneration !== currentMutationGeneration &&
        recorder.forceSnapshotFallback
      ) {
        snapshotBaselineMutationGenerationByCanvas.set(
          canvas,
          currentMutationGeneration
        )
        recorder.forceSnapshotFallback(
          context,
          'bitmap_changed_after_snapshot'
        )
      }
      if (useFallbackScheduler) {
        if (context) {
          // The command recorder has already resumed. Move each known context
          // to its bounded bitmap scheduler instead of globally pausing all
          // canvases behind a serial visibility rebaseline.
          initialSnapshotCanvases.add(canvas)
          if (recorder.forceSnapshotFallback) {
            recorder.forceSnapshotFallback(
              context,
              'visibility_rebaseline'
            )
          }
        }
        return
      }
      var canvasId = getSerializedNodeId(canvas)
      if (
        canvasId !== undefined &&
        canvasId !== null &&
        canvasId !== -1 &&
        !initialSnapshotCanvases.has(canvas) &&
        !queuedInitialSnapshotCanvases.has(canvas) &&
        context
      ) {
        if (
          getPendingInitialSnapshotCount() <
          MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
        ) {
          queuedInitialSnapshotCanvases.add(canvas)
          pendingInitialSnapshotCanvases.push(canvas)
        } else {
          queueOverflow = true
        }
      }
    })
    var shouldContinueScan =
      queueOverflow ||
      (initialSnapshotScanPageCount < MAX_COMMAND_CANVAS_SCAN_PAGES &&
        (foundUnseenCanvas || !canvases.length))
    if (useFallbackScheduler) {
      if (shouldContinueScan) {
        visibilityScanContinuationPending = true
        visibilityScanContinuationGeneration = generation
        scheduleVisibilityScanContinuationIfReady()
      } else {
        visibilityScanContinuationPending = false
        visibilityScanContinuationScheduled = false
        scheduleFallbackQueueDrain()
      }
      return
    }
    shouldContinueInitialSnapshotScan = shouldContinueScan
    runNextInitialSnapshot()
  }

  function runNextInitialSnapshot() {
    if (stopped || runningInitialSnapshotCanvas) {
      return
    }
    if (!getPendingInitialSnapshotCount()) {
      if (shouldContinueInitialSnapshotScan) {
        shouldContinueInitialSnapshotScan = false
        patchExistingCanvases(true, false)
      }
      return
    }

    var canvas
    var canvasId
    while (getPendingInitialSnapshotCount()) {
      canvas = dequeueInitialSnapshotCanvas()
      if (!canvas) {
        continue
      }
      canvasId = getSerializedNodeId(canvas)
      if (
        (!canvasId && canvasId !== 0) ||
        initialSnapshotCanvases.has(canvas) ||
        getReplayCanvasRecordingDecision(configuration, canvas) === false
      ) {
        queuedInitialSnapshotCanvases.delete(canvas)
        canvas = undefined
        continue
      }
      break
    }
    if (!canvas) {
      if (shouldContinueInitialSnapshotScan) {
        shouldContinueInitialSnapshotScan = false
        patchExistingCanvases(true, false)
      }
      return
    }

    var startedAt = now()
    var snapshotGeneration = generation
    var snapshotToken = {
      canvas: canvas,
      generation: snapshotGeneration
    }
    var snapshotBaselineToken =
      createCanvasSnapshotBaselineToken(canvas)
    runningInitialSnapshotCanvas = canvas
    runningInitialSnapshotToken = snapshotToken
    initialSnapshotCanvases.add(canvas)
    Promise.resolve()
      .then(function () {
        return snapshotCanvas(canvas, {
          trigger: 'auto',
          scheduler: 'command_capture',
          reason: 'initial_static_canvas',
          force: true
        })
      })
      .then(function (result) {
        if (
          stopped ||
          snapshotGeneration !== generation ||
          runningInitialSnapshotToken !== snapshotToken
        ) {
          return
        }
        var completedAt = now()
        if (result && result.ok === false) {
          initialSnapshotCanvases.delete(canvas)
        } else if (
          !markCanvasSnapshotBaseline(
            canvas,
            snapshotBaselineToken,
            'initial_bitmap_state'
          )
        ) {
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
        if (
          stopped ||
          snapshotGeneration !== generation ||
          runningInitialSnapshotToken !== snapshotToken
        ) {
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
        if (
          stopped ||
          snapshotGeneration !== generation ||
          runningInitialSnapshotToken !== snapshotToken
        ) {
          return
        }
        queuedInitialSnapshotCanvases.delete(canvas)
        runningInitialSnapshotCanvas = undefined
        runningInitialSnapshotToken = undefined
        if (
          !getPendingInitialSnapshotCount() &&
          shouldContinueInitialSnapshotScan
        ) {
          shouldContinueInitialSnapshotScan = false
          patchExistingCanvases(true, false)
          return
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

  var wrappedGetContext = function (contextType) {
    var context = originalGetContext.apply(this, arguments)
    var shouldRecordContext =
      !stopped &&
      contextType === '2d' &&
      context &&
      !isReplayInternalCanvas(this)
    if (
      shouldRecordContext &&
      getReplayCanvasRecordingDecision(configuration, this) === false
    ) {
      shouldRecordContext = false
    }
    if (shouldRecordContext) {
      setReplayCanvasContextType(this, ReplayCanvasContextType.Canvas2D)
      known2dContextsByCanvas.set(this, context)
      recorder.patchContext(context)
      if (
        initialSnapshotCanvases.has(this) &&
        recorder.markPersistentSnapshotFallback
      ) {
        recorder.markPersistentSnapshotFallback(
          context,
          'existing_bitmap_state'
        )
      }
    } else if (
      contextType === '2d' &&
      context &&
      recorder.rejectContext
    ) {
      recorder.rejectContext(context)
    }
    return context
  }
  window.HTMLCanvasElement.prototype.getContext = wrappedGetContext

  if (isDocumentHidden()) {
    if (recorder.pause) {
      recorder.pause()
    }
  } else if (!waitingForSnapshotBaseline) {
    patchExistingCanvases(false, false)
  }

  if (document.addEventListener && document.removeEventListener) {
    var onVisibilityChange = function () {
      if (isDocumentHidden()) {
        try {
          recorder.flush()
        } catch (_) {}
        generation += 1
        resetFallbackSnapshots()
        if (recorder.pause) {
          recorder.pause()
        }
        return
      }
      if (waitingForSnapshotBaseline) {
        return
      }
      generation += 1
      resetFallbackSnapshots()
      initialSnapshotCanvases = new WeakSet()
      queuedInitialSnapshotCanvases = new WeakSet()
      pendingInitialSnapshotCanvases = []
      pendingInitialSnapshotHead = 0
      runningInitialSnapshotCanvas = undefined
      runningInitialSnapshotToken = undefined
      shouldContinueInitialSnapshotScan = false
      initialSnapshotScanSeenCanvases = new WeakSet()
      initialSnapshotScanPageCount = 0
      if (recorder.reset) {
        recorder.reset()
      }
      if (recorder.resume) {
        recorder.resume()
      }
      patchExistingCanvases(false, true)
    }
    document.addEventListener('visibilitychange', onVisibilityChange)
    removeVisibilityListener = function () {
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }

  return {
    stop: function () {
      try {
        recorder.flush()
      } catch (_) {}
      stopped = true
      generation += 1
      resetFallbackSnapshots()
      pendingInitialSnapshotCanvases = []
      pendingInitialSnapshotHead = 0
      queuedInitialSnapshotCanvases = new WeakSet()
      initialSnapshotScanSeenCanvases = new WeakSet()
      initialSnapshotScanPageCount = 0
      runningInitialSnapshotCanvas = undefined
      runningInitialSnapshotToken = undefined
      shouldContinueInitialSnapshotScan = false
      if (
        window.HTMLCanvasElement.prototype.getContext ===
        wrappedGetContext
      ) {
        window.HTMLCanvasElement.prototype.getContext =
          originalGetContext
      }
      while (restoreCanvasDimensionSetters.length) {
        restoreCanvasDimensionSetters.pop()()
      }
      removeVisibilityListener()
      recorder.stop()
    },
    reset: function () {
      generation += 1
      resetFallbackSnapshots()
      initialSnapshotCanvases = new WeakSet()
      snapshotBaselineMutationGenerationByCanvas = new WeakMap()
      queuedInitialSnapshotCanvases = new WeakSet()
      initialSnapshotScanSeenCanvases = new WeakSet()
      initialSnapshotScanPageCount = 0
      pendingInitialSnapshotCanvases = []
      pendingInitialSnapshotHead = 0
      runningInitialSnapshotCanvas = undefined
      runningInitialSnapshotToken = undefined
      shouldContinueInitialSnapshotScan = false
      waitingForSnapshotBaseline = true
      if (recorder.pause) {
        recorder.pause()
      }
      if (recorder.reset) {
        recorder.reset()
      }
    },
    scanExistingCanvases: function () {
      waitingForSnapshotBaseline = false
      if (isDocumentHidden()) {
        return
      }
      if (recorder.resume) {
        recorder.resume()
      }
      patchExistingCanvases(false, false)
    },
    $rRetryPublishedCanvas: retryPublishedCanvas,
    createCanvasSnapshotBaselineToken: createCanvasSnapshotBaselineToken,
    markCanvasSnapshotBaseline: markCanvasSnapshotBaseline
  }
}
