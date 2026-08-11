import { createCanvas2DCommandRecorder } from './canvasCommandCapture'
import {
  getReplayCanvasRecordingDecision,
  isReplayInternalCanvas,
  ReplayCanvasContextType,
  setReplayCanvasContextType
} from './canvasContext'

var COMMAND_FALLBACK_MIN_COOLDOWN = 120
var MAX_COMMAND_FALLBACK_SNAPSHOTS_PER_RUN = 8
var MAX_COMMAND_FALLBACK_CONCURRENCY = 4
var MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE = 64
var MAX_COMMAND_CANVAS_SCAN_PAGES = 32
var MAX_COMMAND_DEFERRED_FALLBACKS =
  MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE * MAX_COMMAND_CANVAS_SCAN_PAGES
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
      flush: function () {},
      stop: function () {},
      reset: function () {}
    }
  }

  var emit = options.emit
  var now = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.now || Date.now
    : Date.now
  var onDebug = options.onDebug || function () {}
  var onMutationDebug = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.onMutationDebug || function () {}
    : undefined
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
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.scheduleMicrotask) ||
    function (callback) {
      Promise.resolve().then(callback)
    }
  var setTimeoutImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.setTimeoutImpl) ||
    function (callback, delay) {
      return setTimeout(callback, delay)
    }
  var clearTimeoutImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.clearTimeoutImpl) ||
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
  var deferredFallbacks = []
  var deferredFallbackHead = 0
  var fallbackRescanPending = false
  var fallbackRescanScheduled = false
  var visibilityScanContinuationPending = false
  var visibilityScanContinuationGeneration = 0
  var visibilityScanContinuationScheduled = false
  var fallbackCanvasWeakRefFactory =
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
    Object.prototype.hasOwnProperty.call(options, 'weakRefFactory')
    ? typeof options.weakRefFactory === 'function'
      ? options.weakRefFactory
      : undefined
    : typeof WeakRef === 'function'
      ? function (canvas) {
        return new WeakRef(canvas)
      }
      : undefined
  var maxFallbackTimerCount = clampInteger(
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? options.maxFallbackTimerCount
      : undefined,
    MAX_COMMAND_FALLBACK_TIMERS,
    1,
    MAX_COMMAND_FALLBACK_TIMERS
  )
  var maxFallbackTimerDelay = clampInteger(
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__
      ? options.maxFallbackTimerDelay
      : undefined,
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
        $rDeferred: false,
        $rQueued: false,
        retryQueued: false,
        consecutiveRecordRejectedCount: 0,
        $rLastRetryableFailureReason: undefined,
        nextEligibleAt: 0,
        $rPriority: 0,
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

  function getDeferredFallbackCount() {
    return deferredFallbacks.length - deferredFallbackHead
  }

  function createFallbackCanvasRef(canvas) {
    var canvasRef
    try {
      canvasRef = fallbackCanvasWeakRefFactory
        ? fallbackCanvasWeakRefFactory(canvas)
        : undefined
    } catch (_) {}
    if (canvasRef && typeof canvasRef.deref === 'function') {
      return canvasRef
    }
    // WeakRef is unavailable in older browsers. This queue is strictly
    // bounded, so retaining the canvas until its turn is preferable to
    // dropping a final static frame.
    return {
      deref: function () {
        return canvas
      }
    }
  }

  function deferFallbackState(canvas, state) {
    if (state.$rDeferred) {
      return
    }
    if (getDeferredFallbackCount() >= MAX_COMMAND_DEFERRED_FALLBACKS) {
      // Keep memory bounded. The state stays dirty and a rolling DOM scan
      // rediscovers it after the admitted work drains.
      fallbackRescanPending = true
      scheduleFallbackRescanIfReady()
      return
    }
    state.$rDeferred = true
    deferredFallbacks.push({
      canvasRef: createFallbackCanvasRef(canvas),
      state: state,
      generation: fallbackGeneration
    })
  }

  function dequeueDeferredFallback() {
    var deferredFallback = deferredFallbacks[deferredFallbackHead]
    deferredFallbacks[deferredFallbackHead] = undefined
    deferredFallbackHead += 1
    if (deferredFallbackHead === deferredFallbacks.length) {
      deferredFallbacks = []
      deferredFallbackHead = 0
    } else if (
      deferredFallbackHead >= MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
    ) {
      deferredFallbacks = deferredFallbacks.slice(deferredFallbackHead)
      deferredFallbackHead = 0
    }
    return deferredFallback
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
    fallbackReason,
    priority
  ) {
    if (!__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && status !== 'completed') {
      return
    }
    var ok = status === 'completed' && (!result || result.ok !== false)
    var reason =
      status === 'fallback'
        ? fallbackReason
        : result && result.ok === false
          ? result.reason
          : undefined
    onDebug(
      __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? {
            scheduler: 'command_capture',
            status: status,
            startedAt: startedAt,
            completedAt: completedAt,
            timestamp: completedAt,
            eligibleCanvasCount: 1,
            selectedCanvasCount: ok ? 1 : 0,
            skippedBudgetCount: 0,
            keepSessionAliveTriggered: false,
            results: [
              {
                canvasId: getSerializedNodeId(canvas),
                ok: ok,
                reason: reason,
                priority: typeof priority === 'number' ? priority : 0
              }
            ]
          }
        : {
            status: 'completed',
            selectedCanvasCount: ok ? 1 : 0,
            results: [{ ok: ok, reason: reason }]
          }
    )
  }

  function isFallbackPipelineIdle() {
    return (
      !fallbackQueueScheduled &&
      !getFallbackQueueSize() &&
      !getFallbackRetryQueueSize() &&
      !getDeferredFallbackCount() &&
      !activeFallbackSnapshotCount &&
      !fallbackTimerStates.size
    )
  }

  function scheduleFallbackRescanIfReady() {
    if (
      stopped ||
      !fallbackRescanPending ||
      fallbackRescanScheduled ||
      isDocumentHidden() ||
      !isFallbackPipelineIdle()
    ) {
      return
    }
    fallbackRescanScheduled = true
    var scheduledGeneration = fallbackGeneration
    scheduleMicrotask(function () {
      fallbackRescanScheduled = false
      if (
        stopped ||
        scheduledGeneration !== fallbackGeneration ||
        isDocumentHidden() ||
        !isFallbackPipelineIdle()
      ) {
        return
      }
      fallbackRescanPending = false
      patchExistingCanvases(false, true)
    })
  }

  function promoteDeferredFallbacks() {
    var inspectionCount = getDeferredFallbackCount()
    while (
      !stopped &&
      getFallbackWorkCount() < MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE &&
      getDeferredFallbackCount() &&
      inspectionCount > 0
    ) {
      var deferredFallback = dequeueDeferredFallback()
      inspectionCount -= 1
      var state = deferredFallback.state
      state.$rDeferred = false
      if (
        deferredFallback.generation !== fallbackGeneration ||
        !state.$rDirty ||
        state.$rQueued ||
        state.retryQueued ||
        state.$rInFlight ||
        state.$rTimeoutId !== undefined
      ) {
        continue
      }
      var canvas = deferredFallback.canvasRef.deref()
      if (!canvas) {
        state.$rDirty = false
        continue
      }
      var workCount = getFallbackWorkCount()
      enqueueFallbackSnapshot(canvas, state)
      if (state.$rDeferred && getFallbackWorkCount() === workCount) {
        break
      }
    }
    scheduleFallbackRescanIfReady()
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
      scheduleFallbackRescanIfReady()
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
      state.$rDeferred ||
      state.$rInFlight ||
      state.$rTimeoutId !== undefined
    ) {
      return
    }
    if (
      getFallbackWorkCount() >=
      MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
    ) {
      deferFallbackState(canvas, state)
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
      state.$rDeferred ||
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
      deferFallbackState(canvas, state)
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
      state.$rDeferred ||
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
      deferFallbackState(canvas, state)
      return
    }
    if (fallbackTimerStates.size >= maxFallbackTimerCount) {
      enqueueFallbackRetry(canvas, state)
      return
    }
    var canvasRef = createFallbackCanvasRef(canvas)
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
          promoteDeferredFallbacks()
          scheduleFallbackQueueDrain()
          scheduleFallbackRescanIfReady()
          scheduleVisibilityScanContinuationIfReady()
          return
        }
        var referencedCanvas = canvasRef.deref()
        if (!referencedCanvas) {
          state.$rDirty = false
          promoteFallbackRetries()
          promoteDeferredFallbacks()
          scheduleFallbackQueueDrain()
          scheduleFallbackRescanIfReady()
          scheduleVisibilityScanContinuationIfReady()
          return
        }
        enqueueFallbackSnapshot(referencedCanvas, state)
        promoteFallbackRetries()
        promoteDeferredFallbacks()
        scheduleFallbackQueueDrain()
        scheduleFallbackRescanIfReady()
        scheduleVisibilityScanContinuationIfReady()
      }, Math.min(delay, maxFallbackTimerDelay))
    } catch (_) {
      state.$rTimeoutId = undefined
      deferFallbackState(canvas, state)
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

    var recordingDecision = getReplayCanvasRecordingDecision(
      configuration,
      canvas
    )
    if (recordingDecision === false) {
      state.$rDirty = false
      state.$rReason = undefined
      return
    }
    state.$rPriority =
      typeof recordingDecision === 'number' ? recordingDecision : 0

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
      fallbackReason,
      state.$rPriority
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
          if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
            debugResult = {
              ok: false,
              reason: result.reason + '_retry_exhausted'
            }
          }
        }
        notifyFallbackSnapshot(
          canvas,
          'completed',
          startedAt,
          completedAt,
          debugResult,
          fallbackReason,
          state.$rPriority
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
        promoteFallbackRetries()
        promoteDeferredFallbacks()
        scheduleFallbackQueueDrain()
        scheduleFallbackRescanIfReady()
        scheduleVisibilityScanContinuationIfReady()
      })
  }

  function drainFallbackQueue() {
    if (stopped || isDocumentHidden()) {
      return
    }
    promoteFallbackRetries()
    promoteDeferredFallbacks()
    while (
      activeFallbackSnapshotCount < maxActiveFallbackSnapshots &&
      getFallbackQueueSize()
    ) {
      var queuedFallback = dequeueFallback()
      var state = queuedFallback.state
      state.$rQueued = false
      promoteFallbackRetries()
      promoteDeferredFallbacks()
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
    promoteDeferredFallbacks()
    scheduleFallbackQueueDrain()
    scheduleFallbackRescanIfReady()
    scheduleVisibilityScanContinuationIfReady()
  }

  function requestFallbackSnapshot(context, reason) {
    if (!context || !context.canvas || stopped || isDocumentHidden()) {
      return
    }
    var canvas = context.canvas
    var state = getFallbackState(canvas)
    var recordingDecision = getReplayCanvasRecordingDecision(
      configuration,
      canvas
    )
    if (recordingDecision === false) {
      clearFallbackTimer(state)
      state.$rDirty = false
      state.$rReason = undefined
      return
    }
    state.$rPriority =
      typeof recordingDecision === 'number' ? recordingDecision : 0
    var hasActiveFallbackCycle =
      state.$rDirty ||
      state.$rInFlight ||
      state.$rQueued ||
      state.retryQueued ||
      state.$rDeferred ||
      state.$rTimeoutId !== undefined
    if (!hasActiveFallbackCycle) {
      // A draw after a settled/exhausted cycle starts a fresh bounded retry
      // budget. Draws arriving while a snapshot or retry is already pending
      // merely mark that cycle dirty; resetting here would let a busy canvas
      // evade the retry cap forever under persistent segment backpressure.
      state.consecutiveRecordRejectedCount = 0
      state.$rLastRetryableFailureReason = undefined
    }
    state.$rDirty = true
    if (!state.$rReason) {
      state.$rReason = reason || 'unsupported_canvas_object'
    }
    if (
      state.$rInFlight ||
      state.$rQueued ||
      state.retryQueued ||
      state.$rDeferred ||
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
    var context = known2dContextsByCanvas.get(canvas)
    if (context && recorder.retryPublishedContext) {
      recorder.retryPublishedContext(context)
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
    deferredFallbacks = []
    deferredFallbackHead = 0
    fallbackQueueScheduled = false
    fallbackRescanPending = false
    fallbackRescanScheduled = false
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
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.commandRecorder) ||
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
      requestAnimationFrameImpl: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? options.requestAnimationFrameImpl
        : undefined,
      cancelAnimationFrameImpl: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? options.cancelAnimationFrameImpl
        : undefined,
      requestSnapshotFallback: requestFallbackSnapshot,
      onCommandOverflow: __BUILD_ENV__REPLAY_DEBUG_ENABLED__
        ? function (overflow) {
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
          }
        : undefined,
      emit: function (event, metadata) {
        var recordAccepted = emit(event)
        if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
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
        }
        var summary = {
          status: 'completed',
          selectedCanvasCount: 1,
          results: [
            {
              ok: recordAccepted !== false,
              reason:
                recordAccepted === false
                  ? 'command_record_rejected'
                  : undefined
            }
          ]
        }
        if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
          summary.scheduler = 'command_capture'
          summary.startedAt = startedAt
          summary.completedAt = completedAt
          summary.timestamp = completedAt
          summary.eligibleCanvasCount = 1
          summary.skippedBudgetCount = 0
          summary.keepSessionAliveTriggered = false
          summary.results[0].canvasId = event.data && event.data.id
          summary.results[0].priority = undefined
        }
        onDebug(summary)
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
      typeof descriptor.get !== 'function' ||
      typeof descriptor.set !== 'function'
    ) {
      return
    }
    var originalSetter = descriptor.set
    var wrappedSetter = function () {
      var shouldInvalidateSnapshot =
        !stopped && !isReplayInternalCanvas(this)
      var context = shouldInvalidateSnapshot
        ? known2dContextsByCanvas.get(this)
        : undefined
      var shouldTrackCommandBarrier =
        shouldInvalidateSnapshot &&
        !waitingForSnapshotBaseline &&
        !!context
      if (shouldTrackCommandBarrier) {
        try {
          var canvasId = getSerializedNodeId(this)
          shouldTrackCommandBarrier =
            canvasId !== undefined &&
            canvasId !== null &&
            canvasId !== -1
        } catch (_) {
          shouldTrackCommandBarrier = false
        }
      }
      if (shouldTrackCommandBarrier) {
        try {
          if (recorder.flushContext) {
            recorder.flushContext(context)
          } else {
            recorder.flush()
          }
        } catch (_) {}
      }
      var previousDimension
      var hasPreviousDimension = false
      if (shouldInvalidateSnapshot) {
        try {
          previousDimension = descriptor.get.call(this)
          hasPreviousDimension = true
        } catch (_) {}
      }
      var result = originalSetter.apply(this, arguments)
      if (shouldInvalidateSnapshot) {
        markCanvasMutation(this)
      }
      if (context && !waitingForSnapshotBaseline) {
        var hasSameDimension = false
        if (hasPreviousDimension) {
          try {
            hasSameDimension =
              descriptor.get.call(this) === previousDimension
          } catch (_) {}
        }
        if (
          (!shouldTrackCommandBarrier || hasSameDimension) &&
          recorder.forceSnapshotFallback
        ) {
          try {
            recorder.forceSnapshotFallback(
              context,
              'canvas_dimension_reset'
            )
          } catch (_) {}
        } else if (
          shouldTrackCommandBarrier &&
          options.flushMutations
        ) {
          var mutationFlushSucceeded = true
          try {
            mutationFlushSucceeded =
              options.flushMutations(this) !== false
          } catch (_) {
            mutationFlushSucceeded = false
          }
          if (
            !mutationFlushSucceeded &&
            recorder.forceSnapshotFallback
          ) {
            try {
              recorder.forceSnapshotFallback(
                context,
                'canvas_dimension_mutation_flush_failed'
              )
            } catch (_) {}
          }
        }
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

  function isCanvasSnapshotBaselineTokenCurrent(canvas, token) {
    return (
      !stopped &&
      !!canvas &&
      !!token &&
      token.canvas === canvas &&
      token.generation === generation &&
      token.mutationGeneration ===
        (canvasMutationGenerationByCanvas.get(canvas) || 0)
    )
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
    if (context && recorder.markPersistentSnapshotFallback) {
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
      var reachedFallbackScanBudget =
        initialSnapshotScanPageCount >= MAX_COMMAND_CANVAS_SCAN_PAGES &&
        foundUnseenCanvas &&
        canvases.length >= MAX_COMMAND_INITIAL_SNAPSHOT_QUEUE
      if (reachedFallbackScanBudget) {
        // Pause after each bounded page window, but preserve the WeakSet and
        // rolling DOM offset. This lets very large pages continue after the
        // current work drains and stop naturally once the scan wraps.
        initialSnapshotScanPageCount = 0
      }
      if (shouldContinueScan || reachedFallbackScanBudget) {
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
    var recordingDecision
    while (getPendingInitialSnapshotCount()) {
      canvas = dequeueInitialSnapshotCanvas()
      if (!canvas) {
        continue
      }
      canvasId = getSerializedNodeId(canvas)
      recordingDecision = getReplayCanvasRecordingDecision(
        configuration,
        canvas
      )
      if (
        (!canvasId && canvasId !== 0) ||
        initialSnapshotCanvases.has(canvas) ||
        recordingDecision === false
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

    var startedAt = __BUILD_ENV__REPLAY_DEBUG_ENABLED__ ? now() : undefined
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
        var completedAt = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
          ? now()
          : undefined
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
        var ok = !(result && result.ok === false)
        var summary = {
          status: 'completed',
          selectedCanvasCount: ok ? 1 : 0,
          results: [
            {
              ok: ok,
              reason: result && result.ok === false ? result.reason : undefined
            }
          ]
        }
        if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
          summary.scheduler = 'command_capture'
          summary.startedAt = startedAt
          summary.completedAt = completedAt
          summary.timestamp = completedAt
          summary.eligibleCanvasCount = 1
          summary.skippedBudgetCount = 0
          summary.keepSessionAliveTriggered = false
          summary.results[0].canvasId = canvasId
          summary.results[0].priority =
            typeof recordingDecision === 'number' ? recordingDecision : 0
        }
        onDebug(summary)
      })
      .catch(function () {
        if (
          stopped ||
          snapshotGeneration !== generation ||
          runningInitialSnapshotToken !== snapshotToken
        ) {
          return
        }
        initialSnapshotCanvases.delete(canvas)
        if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
          var completedAt = now()
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
                priority:
                  typeof recordingDecision === 'number'
                    ? recordingDecision
                    : 0
              }
            ]
          })
        }
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
    flush: function () {
      try {
        recorder.flush()
      } catch (_) {}
    },
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
    $rIsSnapshotBaselineCurrent:
      isCanvasSnapshotBaselineTokenCurrent,
    markCanvasSnapshotBaseline: markCanvasSnapshotBaseline
  }
}
