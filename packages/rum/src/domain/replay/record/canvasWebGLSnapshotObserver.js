import { addEventListener, assign, DOM_EVENT } from '@cloudcare/browser-core'
import {
  getReplayCanvasRecordingDecision,
  getReplayCanvasContextType,
  isReplayInternalCanvas,
  ReplayCanvasContextType,
  normalizeReplayCanvasContextType,
  setReplayCanvasContextType
} from './canvasContext'

var WEBGL_DRAW_METHODS = [
  'clear',
  'clearBufferfv',
  'clearBufferiv',
  'clearBufferuiv',
  'clearBufferfi',
  'drawArrays',
  'drawElements',
  'drawArraysInstanced',
  'drawElementsInstanced',
  'drawRangeElements',
  'blitFramebuffer'
]
var WEBGL_EXTENSION_DRAW_METHODS = [
  'drawArraysInstancedANGLE',
  'drawElementsInstancedANGLE',
  'multiDrawArraysWEBGL',
  'multiDrawElementsWEBGL',
  'multiDrawArraysInstancedWEBGL',
  'multiDrawElementsInstancedWEBGL',
  'drawArraysInstancedBaseInstanceWEBGL',
  'drawElementsInstancedBaseVertexBaseInstanceWEBGL',
  'multiDrawArraysInstancedBaseInstanceWEBGL',
  'multiDrawElementsInstancedBaseVertexBaseInstanceWEBGL'
]
var MIN_WEBGL_SNAPSHOT_INTERVAL = 50
var MAX_WEBGL_SNAPSHOT_INTERVAL = 60000
var MAX_WEBGL_SNAPSHOTS_PER_RUN = 8
var MAX_WEBGL_CONCURRENT_SNAPSHOTS = 4
var MAX_WEBGL_EXTENSION_PATCH_RECORDS = 32
var WEBGL_MAIN_THREAD_CAPTURE_BUDGET = 2
var MAX_WEBGL_ADAPTIVE_INTERVAL_FACTOR = 8

function isWebGLSnapshotRecordingEnabled(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto'
  )
}

function isDocumentHidden(getVisibilityState) {
  return getVisibilityState() === 'hidden'
}

function getWebGLSnapshotInterval(configuration) {
  var interval
  if (
    typeof configuration.replayCanvasAutoInterval === 'number' &&
    configuration.replayCanvasAutoInterval > 0
  ) {
    interval = configuration.replayCanvasAutoInterval
  } else if (
    typeof configuration.replayCanvasSampling === 'number' &&
    configuration.replayCanvasSampling > 0
  ) {
    interval = 1000 / configuration.replayCanvasSampling
  } else {
    interval = 1000
  }
  return Math.min(
    Math.max(interval, MIN_WEBGL_SNAPSHOT_INTERVAL),
    MAX_WEBGL_SNAPSHOT_INTERVAL
  )
}

function getAdaptiveWebGLSnapshotInterval(
  configuration,
  mainThreadCaptureDuration
) {
  var interval = getWebGLSnapshotInterval(configuration)
  if (
    typeof mainThreadCaptureDuration !== 'number' ||
    mainThreadCaptureDuration <= WEBGL_MAIN_THREAD_CAPTURE_BUDGET
  ) {
    return interval
  }
  var adaptiveFactor = Math.min(
    Math.ceil(
      mainThreadCaptureDuration / WEBGL_MAIN_THREAD_CAPTURE_BUDGET
    ),
    MAX_WEBGL_ADAPTIVE_INTERVAL_FACTOR
  )
  return Math.min(
    interval * adaptiveFactor,
    MAX_WEBGL_SNAPSHOT_INTERVAL
  )
}

function getWebGLSnapshotCooldown(configuration, result) {
  if (!result || result.ok !== false) {
    return configuration.replayCanvasAutoCooldown || 0
  }
  if (result.reason === 'unchanged' || result.reason === 'below_threshold') {
    return configuration.replayCanvasAutoUnchangedBackoff || 0
  }
  return configuration.replayCanvasAutoFailureBackoff || 0
}

function getWebGLSnapshotNextEligibleAt(
  configuration,
  result,
  startedAt,
  completedAt,
  mainThreadCaptureDuration
) {
  return Math.max(
    startedAt +
      getAdaptiveWebGLSnapshotInterval(
        configuration,
        mainThreadCaptureDuration
      ),
    completedAt + getWebGLSnapshotCooldown(configuration, result)
  )
}

function clampInteger(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !isFinite(value)) {
    return fallback
  }
  return Math.min(Math.max(Math.floor(value), minimum), maximum)
}

function getDefaultCurrentTime() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

function getDefaultContextPrototypeEntries() {
  var entries = []
  if (
    typeof window.WebGLRenderingContext === 'function' &&
    window.WebGLRenderingContext.prototype
  ) {
    entries.push({
      contextType: ReplayCanvasContextType.WebGL,
      prototype: window.WebGLRenderingContext.prototype
    })
  }
  if (
    typeof window.WebGL2RenderingContext === 'function' &&
    window.WebGL2RenderingContext.prototype
  ) {
    entries.push({
      contextType: ReplayCanvasContextType.WebGL2,
      prototype: window.WebGL2RenderingContext.prototype
    })
  }
  return entries
}

function getContextTypeForDraw(context, contextType) {
  var canvasContextType =
    context && context.canvas
      ? getReplayCanvasContextType(context.canvas)
      : undefined
  if (canvasContextType) {
    return canvasContextType
  }

  try {
    if (
      typeof window.WebGL2RenderingContext === 'function' &&
      context instanceof window.WebGL2RenderingContext
    ) {
      return ReplayCanvasContextType.WebGL2
    }
  } catch (_) {}

  return contextType
}

function patchDrawMethod(target, methodName, contextType, onDraw) {
  var descriptor = Object.getOwnPropertyDescriptor(target, methodName)
  if (!descriptor || typeof descriptor.value !== 'function') {
    return function () {}
  }

  var originalMethod = descriptor.value
  var wrappedMethod = function () {
    var result = originalMethod.apply(this, arguments)
    onDraw(this, contextType)
    return result
  }

  try {
    Object.defineProperty(
      target,
      methodName,
      assign({}, descriptor, { value: wrappedMethod })
    )
  } catch (_) {
    return function () {}
  }

  return function () {
    try {
      if (target[methodName] === wrappedMethod) {
        Object.defineProperty(target, methodName, descriptor)
      }
    } catch (_) {}
  }
}

function getMethodOwner(target, methodName) {
  var currentTarget = target
  while (currentTarget && currentTarget !== Object.prototype) {
    var descriptor = Object.getOwnPropertyDescriptor(
      currentTarget,
      methodName
    )
    if (descriptor && typeof descriptor.value === 'function') {
      return currentTarget
    }
    currentTarget = Object.getPrototypeOf(currentTarget)
  }
}

function patchExtensionDrawMethod(
  target,
  methodName,
  extensionContextByObject,
  onDraw
) {
  var descriptor = Object.getOwnPropertyDescriptor(target, methodName)
  if (!descriptor || typeof descriptor.value !== 'function') {
    return
  }

  var originalMethod = descriptor.value
  var wrappedMethod = function () {
    var result = originalMethod.apply(this, arguments)
    var contextState = extensionContextByObject.get(this)
    if (contextState) {
      onDraw(contextState.context, contextState.contextType)
    }
    return result
  }

  try {
    Object.defineProperty(
      target,
      methodName,
      assign({}, descriptor, { value: wrappedMethod })
    )
  } catch (_) {
    return
  }

  return function () {
    try {
      if (target[methodName] === wrappedMethod) {
        Object.defineProperty(target, methodName, descriptor)
      }
    } catch (_) {}
  }
}

function patchGetExtension(target, contextType, onExtension) {
  var descriptor = Object.getOwnPropertyDescriptor(target, 'getExtension')
  if (!descriptor || typeof descriptor.value !== 'function') {
    return function () {}
  }

  var originalGetExtension = descriptor.value
  var wrappedGetExtension = function () {
    var extension = originalGetExtension.apply(this, arguments)
    if (extension) {
      onExtension(extension, this, contextType)
    }
    return extension
  }

  try {
    Object.defineProperty(
      target,
      'getExtension',
      assign({}, descriptor, { value: wrappedGetExtension })
    )
  } catch (_) {
    return function () {}
  }

  return function () {
    try {
      if (target.getExtension === wrappedGetExtension) {
        Object.defineProperty(target, 'getExtension', descriptor)
      }
    } catch (_) {}
  }
}

function patchCanvasGetContext(canvasPrototype) {
  if (!canvasPrototype || typeof canvasPrototype.getContext !== 'function') {
    return function () {}
  }

  var originalGetContext = canvasPrototype.getContext
  var wrappedGetContext = function (contextType) {
    var context = originalGetContext.apply(this, arguments)
    var normalizedContextType = normalizeReplayCanvasContextType(contextType)
    if (context && normalizedContextType) {
      setReplayCanvasContextType(this, normalizedContextType)
    }
    return context
  }

  try {
    canvasPrototype.getContext = wrappedGetContext
  } catch (_) {
    return function () {}
  }
  return function () {
    if (canvasPrototype.getContext === wrappedGetContext) {
      try {
        canvasPrototype.getContext = originalGetContext
      } catch (_) {}
    }
  }
}

function patchRequestAnimationFrame(
  animationFrameTarget,
  onCallbackStarted,
  onCallbackCompleted
) {
  if (
    !animationFrameTarget ||
    typeof animationFrameTarget.requestAnimationFrame !== 'function'
  ) {
    return
  }

  var originalRequestAnimationFrame =
    animationFrameTarget.requestAnimationFrame
  var wrappedRequestAnimationFrame = function (callback) {
    if (typeof callback !== 'function') {
      return originalRequestAnimationFrame.apply(this, arguments)
    }
    return originalRequestAnimationFrame.call(this, function (timestamp) {
      onCallbackStarted(timestamp)
      try {
        return callback.call(this, timestamp)
      } finally {
        onCallbackCompleted(timestamp)
      }
    })
  }

  try {
    animationFrameTarget.requestAnimationFrame =
      wrappedRequestAnimationFrame
  } catch (_) {
    return
  }

  return function () {
    try {
      if (
        animationFrameTarget.requestAnimationFrame ===
        wrappedRequestAnimationFrame
      ) {
        animationFrameTarget.requestAnimationFrame =
          originalRequestAnimationFrame
      }
    } catch (_) {}
  }
}

export function startCanvasWebGLSnapshotObserver(options) {
  var configuration = options.configuration
  if (!isWebGLSnapshotRecordingEnabled(configuration)) {
    return {
      stop: function () {},
      reset: function () {}
    }
  }

  var snapshotCanvas = options.snapshotCanvas
  var onDebug = options.onDebug || function () {}
  var now = options.now || Date.now
  var getCurrentTime = options.getCurrentTime || getDefaultCurrentTime
  var getSerializedNodeId = options.getSerializedNodeId || function () {}
  var getVisibilityState =
    options.getVisibilityState ||
    function () {
      return document.visibilityState
    }
  var scheduleMicrotask =
    options.scheduleMicrotask ||
    function (callback) {
      Promise.resolve().then(callback)
    }
  var contextPrototypeEntries =
    options.contextPrototypeEntries || getDefaultContextPrototypeEntries()
  var canvasPrototype =
    options.canvasPrototype ||
    (window.HTMLCanvasElement && window.HTMLCanvasElement.prototype)
  var animationFrameTarget =
    options.animationFrameTarget === undefined
      ? window
      : options.animationFrameTarget
  var addEventListenerImpl = options.addEventListenerImpl || addEventListener
  var stateByCanvas = new WeakMap()
  var restoreHandlers = []
  var pendingCanvases = []
  var waitingCanvases = []
  var reservedCanvas
  var reservedAnimationFrameTimestamp
  var reservedBoundaryMissCount = 0
  var pendingDrainScheduled = false
  var activeSnapshotCount = 0
  var extensionContextByObject = new WeakMap()
  var extensionPatchRecords = []
  var maxSnapshotsPerRun = clampInteger(
    configuration.replayCanvasAutoMaxPerRun,
    1,
    1,
    MAX_WEBGL_SNAPSHOTS_PER_RUN
  )
  var maxConcurrentSnapshots = clampInteger(
    configuration.replayCanvasMaxConcurrentEncodes,
    1,
    1,
    Math.min(
      maxSnapshotsPerRun,
      MAX_WEBGL_CONCURRENT_SNAPSHOTS
    )
  )
  var maxQueuedCanvases = Math.max(maxSnapshotsPerRun * 2, 50)
  var shouldRecordCanvasCacheDuration = Math.max(
    getWebGLSnapshotInterval(configuration),
    1000
  )
  var generation = 0
  var selectionSequence = 0
  var stopped = false
  var visibilityChangeListener
  var animationFrameCallbackDepth = 0

  function getCanvasState(canvas) {
    var state = stateByCanvas.get(canvas)
    if (!state) {
      state = {
        $rDirty: false,
        $rInFlight: false,
        $rQueued: false,
        $rWaiting: false,
        $rLastSelectedSequence: 0,
        nextEligibleAt: 0,
        contextType: undefined,
        shouldRecordCanvasAllowed: undefined,
        shouldRecordCanvasCheckedAt: undefined
      }
      stateByCanvas.set(canvas, state)
    }
    return state
  }

  function notifySnapshotResult(canvas, startedAt, completedAt, result) {
    onDebug({
      scheduler: 'webgl_snapshot',
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
          canvasId: getSerializedNodeId(canvas),
          ok: !result || result.ok !== false,
          reason: result && result.ok === false ? result.reason : undefined,
          priority: undefined
        }
      ]
    })
  }

  function isCanvasAllowedByConfiguration(canvas, state) {
    var currentTime = now()
    if (
      state.shouldRecordCanvasCheckedAt !== undefined &&
      currentTime - state.shouldRecordCanvasCheckedAt <
        shouldRecordCanvasCacheDuration
    ) {
      return state.shouldRecordCanvasAllowed
    }

    var allowed =
      getReplayCanvasRecordingDecision(configuration, canvas) !== false
    state.shouldRecordCanvasAllowed = allowed
    state.shouldRecordCanvasCheckedAt = currentTime
    return allowed
  }

  function scheduleQueueDrain() {
    if (
      stopped ||
      pendingDrainScheduled ||
      !pendingCanvases.length ||
      activeSnapshotCount >= maxConcurrentSnapshots
    ) {
      return
    }
    if (animationFrameCallbackDepth > 0) {
      return
    }
    pendingDrainScheduled = true
    scheduleMicrotask(function () {
      pendingDrainScheduled = false
      drainSnapshotQueue()
    })
  }

  function drainQueueAtAnimationFrameBoundary(animationFrameTimestamp) {
    animationFrameCallbackDepth = Math.max(
      animationFrameCallbackDepth - 1,
      0
    )
    if (
      animationFrameCallbackDepth > 0 ||
      stopped ||
      !pendingCanvases.length
    ) {
      return
    }
    pendingDrainScheduled = false
    drainSnapshotQueue(animationFrameTimestamp)
  }

  function enqueueCanvas(canvas, state) {
    if (
      stopped ||
      state.$rQueued ||
      state.$rInFlight
    ) {
      return
    }
    if (!isCanvasAllowedByConfiguration(canvas, state)) {
      state.$rDirty = false
      return
    }
    if (pendingCanvases.length >= maxQueuedCanvases) {
      state.$rDirty = false
      return
    }
    state.$rQueued = true
    pendingCanvases.push({
      canvas: canvas,
      state: state,
      generation: generation
    })
    scheduleQueueDrain()
  }

  function observeExtension(extension, context, contextType) {
    extensionContextByObject.set(extension, {
      context: context,
      contextType: contextType
    })

    WEBGL_EXTENSION_DRAW_METHODS.forEach(function (methodName) {
      if (
        extensionPatchRecords.length >=
        MAX_WEBGL_EXTENSION_PATCH_RECORDS
      ) {
        return
      }
      var methodOwner = getMethodOwner(extension, methodName)
      if (!methodOwner) {
        return
      }
      var alreadyPatched = extensionPatchRecords.some(function (record) {
        return (
          record.target === methodOwner &&
          record.methodName === methodName
        )
      })
      if (alreadyPatched) {
        return
      }
      var restore = patchExtensionDrawMethod(
        methodOwner,
        methodName,
        extensionContextByObject,
        onDraw
      )
      if (!restore) {
        return
      }
      extensionPatchRecords.push({
        target: methodOwner,
        methodName: methodName
      })
      restoreHandlers.push(restore)
    })
  }

  function runSnapshot(canvas, state, contextType, scheduledGeneration) {
    if (
      stopped ||
      scheduledGeneration !== generation ||
      isDocumentHidden(getVisibilityState) ||
      state.$rInFlight ||
      !state.$rDirty ||
      !isCanvasAllowedByConfiguration(canvas, state)
    ) {
      state.$rDirty = false
      return 0
    }

    var startedAt = now()
    state.$rDirty = false
    state.$rInFlight = true
    state.$rWaiting = false
    if (reservedCanvas === canvas) {
      reservedCanvas = undefined
      reservedAnimationFrameTimestamp = undefined
      reservedBoundaryMissCount = 0
    }
    selectionSequence += 1
    state.$rLastSelectedSequence = selectionSequence
    activeSnapshotCount += 1
    var snapshotResult
    var mainThreadCaptureStartedAt = getCurrentTime()
    var mainThreadCaptureDuration
    try {
      snapshotResult = snapshotCanvas(canvas, {
        trigger: 'auto',
        scheduler: 'webgl_snapshot',
        contextType: contextType
      })
    } catch (_) {
      snapshotResult = {
        ok: false,
        reason: 'encode_failed'
      }
    } finally {
      mainThreadCaptureDuration = Math.max(
        getCurrentTime() - mainThreadCaptureStartedAt,
        0
      )
    }

    Promise.resolve(snapshotResult)
      .catch(function () {
        return {
          ok: false,
          reason: 'encode_failed'
        }
      })
      .then(function (result) {
        if (stopped || scheduledGeneration !== generation) {
          return
        }
        var completedAt = now()
        state.nextEligibleAt = getWebGLSnapshotNextEligibleAt(
          configuration,
          result,
          startedAt,
          completedAt,
          mainThreadCaptureDuration
        )
        notifySnapshotResult(canvas, startedAt, completedAt, result)
      })
      .finally(function () {
        state.$rInFlight = false
        activeSnapshotCount = Math.max(activeSnapshotCount - 1, 0)
      })
    return mainThreadCaptureDuration
  }

  function dropPendingCanvasFrames() {
    while (pendingCanvases.length) {
      var queuedCanvas = pendingCanvases.shift()
      queuedCanvas.state.$rQueued = false
      queuedCanvas.state.$rDirty = false
    }
  }

  function releasePendingCanvasFrames() {
    while (pendingCanvases.length) {
      pendingCanvases.shift().state.$rQueued = false
    }
  }

  function markCanvasWaiting(canvas, state) {
    if (state.$rWaiting) {
      return
    }
    if (waitingCanvases.length >= maxQueuedCanvases) {
      waitingCanvases = waitingCanvases.filter(function (waitingCanvas) {
        return (
          waitingCanvas.generation === generation &&
          waitingCanvas.state.$rWaiting
        )
      })
      if (waitingCanvases.length >= maxQueuedCanvases) {
        return
      }
    }
    state.$rWaiting = true
    waitingCanvases.push({
      canvas: canvas,
      state: state,
      generation: generation
    })
  }

  function takeNextWaitingCanvas() {
    while (waitingCanvases.length) {
      var waitingCanvas = waitingCanvases.shift()
      if (
        waitingCanvas.generation === generation &&
        waitingCanvas.state.$rWaiting
      ) {
        waitingCanvas.state.$rWaiting = false
        return waitingCanvas.canvas
      }
    }
  }

  function prioritizeWaitingCanvas(animationFrameTimestamp) {
    if (
      reservedCanvas &&
      reservedAnimationFrameTimestamp !== animationFrameTimestamp
    ) {
      reservedCanvas = undefined
      reservedAnimationFrameTimestamp = undefined
      reservedBoundaryMissCount = 0
    }
    var reservedCanvasIndex = -1
    var waitingCanvasIndex = -1
    for (
      var pendingIndex = 0;
      pendingIndex < pendingCanvases.length;
      pendingIndex += 1
    ) {
      var queuedCanvas = pendingCanvases[pendingIndex]
      if (queuedCanvas.canvas === reservedCanvas) {
        reservedCanvasIndex = pendingIndex
        break
      }
      if (
        waitingCanvasIndex === -1 &&
        queuedCanvas.state.$rWaiting
      ) {
        waitingCanvasIndex = pendingIndex
      }
    }
    if (reservedCanvas && reservedCanvasIndex < 0) {
      if (
        animationFrameTimestamp !== undefined ||
        reservedBoundaryMissCount < 1
      ) {
        reservedBoundaryMissCount += 1
        releasePendingCanvasFrames()
        return true
      }
      reservedCanvas = undefined
      reservedAnimationFrameTimestamp = undefined
      reservedBoundaryMissCount = 0
    }
    var priorityIndex =
      reservedCanvasIndex >= 0 ? reservedCanvasIndex : waitingCanvasIndex
    if (priorityIndex > 0) {
      pendingCanvases.unshift(
        pendingCanvases.splice(priorityIndex, 1)[0]
      )
    }
    if (priorityIndex >= 0) {
      return true
    }
    reservedCanvas = takeNextWaitingCanvas()
    if (!reservedCanvas) {
      return false
    }
    reservedAnimationFrameTimestamp = animationFrameTimestamp
    reservedBoundaryMissCount = 0
    // Keep the encoder slot free until the previously starved canvas reaches
    // its own draw boundary. Never read its preserveDrawingBuffer=false frame
    // from the earlier callback.
    releasePendingCanvasFrames()
    return true
  }

  function drainSnapshotQueue(animationFrameTimestamp) {
    if (stopped || isDocumentHidden(getVisibilityState)) {
      dropPendingCanvasFrames()
      return
    }
    var selectedCount = 0
    var synchronousCaptureDuration = 0
    var pendingInspectionCount = pendingCanvases.length
    if (pendingInspectionCount > 1) {
      // Prefer canvases that have waited the longest across rendering
      // boundaries. Without this rotation, a fixed draw order can let the
      // first canvas monopolize a single encoder slot forever.
      pendingCanvases.sort(function (left, right) {
        if (left.state.$rWaiting !== right.state.$rWaiting) {
          return left.state.$rWaiting ? -1 : 1
        }
        return (
          left.state.$rLastSelectedSequence -
          right.state.$rLastSelectedSequence
        )
      })
    }
    if (
      prioritizeWaitingCanvas(animationFrameTimestamp) &&
      reservedCanvas &&
      !pendingCanvases.some(function (queuedCanvas) {
        return queuedCanvas.canvas === reservedCanvas
      })
    ) {
      return
    }
    while (
      activeSnapshotCount < maxConcurrentSnapshots &&
      selectedCount < maxSnapshotsPerRun &&
      pendingCanvases.length &&
      pendingInspectionCount > 0
    ) {
      var queuedCanvas = pendingCanvases.shift()
      pendingInspectionCount -= 1
      var state = queuedCanvas.state
      state.$rQueued = false
      if (
        queuedCanvas.generation !== generation ||
        !state.$rDirty
      ) {
        continue
      }
      if (now() < state.nextEligibleAt) {
        // A timeout would capture outside the draw callback that produced the
        // frame. Keep the dirty marker and wait for a subsequent eligible draw
        // so preserveDrawingBuffer=false contexts are read at a real rendering
        // boundary.
        continue
      }
      selectedCount += 1
      synchronousCaptureDuration += runSnapshot(
        queuedCanvas.canvas,
        state,
        state.contextType,
        queuedCanvas.generation
      )
      if (
        synchronousCaptureDuration >= WEBGL_MAIN_THREAD_CAPTURE_BUDGET
      ) {
        break
      }
    }
    // An async encoder slot becoming available is not a safe WebGL rendering
    // boundary. Release frames that could not be synchronously staged while a
    // slot was available and wait for their next draw instead.
    if (
      activeSnapshotCount >= maxConcurrentSnapshots &&
      pendingCanvases.length
    ) {
      releasePendingCanvasFrames()
      return
    }
    // A main-thread-budget continuation stays in the same microtask checkpoint
    // as the draw and therefore before the browser can composite/clear a
    // preserveDrawingBuffer=false context.
    if (pendingInspectionCount > 0) {
      scheduleQueueDrain()
    }
  }

  function onDraw(context, contextType) {
    var canvas = context && context.canvas
    if (
      stopped ||
      !canvas ||
      isReplayInternalCanvas(canvas) ||
      (typeof HTMLCanvasElement !== 'undefined' &&
        !(canvas instanceof HTMLCanvasElement))
    ) {
      return
    }

    contextType = getContextTypeForDraw(context, contextType)
    var state = getCanvasState(canvas)
    if (state.contextType !== contextType) {
      state.contextType = contextType
      setReplayCanvasContextType(canvas, contextType)
    }
    if (state.$rQueued || state.$rInFlight) {
      state.$rDirty = true
      return
    }
    if (isDocumentHidden(getVisibilityState)) {
      state.$rDirty = false
      return
    }
    if (now() < state.nextEligibleAt) {
      state.$rDirty = true
      return
    }
    if (activeSnapshotCount >= maxConcurrentSnapshots) {
      state.$rDirty = true
      markCanvasWaiting(canvas, state)
      return
    }
    state.$rDirty = true
    enqueueCanvas(canvas, state)
  }

  function resetSchedulerState() {
    generation += 1
    selectionSequence = 0
    pendingCanvases = []
    waitingCanvases = []
    reservedCanvas = undefined
    reservedAnimationFrameTimestamp = undefined
    reservedBoundaryMissCount = 0
    pendingDrainScheduled = false
    stateByCanvas = new WeakMap()
  }

  contextPrototypeEntries.forEach(function (entry) {
    WEBGL_DRAW_METHODS.forEach(function (methodName) {
      restoreHandlers.push(
        patchDrawMethod(
          entry.prototype,
          methodName,
          entry.contextType,
          onDraw
        )
      )
    })
    restoreHandlers.push(
      patchGetExtension(
        entry.prototype,
        entry.contextType,
        observeExtension
      )
    )
  })
  restoreHandlers.push(patchCanvasGetContext(canvasPrototype))
  var restoreAnimationFrame = patchRequestAnimationFrame(
    animationFrameTarget,
    function () {
      animationFrameCallbackDepth += 1
    },
    drainQueueAtAnimationFrameBoundary
  )
  if (restoreAnimationFrame) {
    restoreHandlers.push(restoreAnimationFrame)
  }

  visibilityChangeListener = addEventListenerImpl(
    document,
    DOM_EVENT.VISIBILITY_CHANGE,
    function () {
      if (isDocumentHidden(getVisibilityState)) {
        resetSchedulerState()
      }
    },
    { capture: true }
  )

  return {
    stop: function () {
      stopped = true
      try {
        resetSchedulerState()
      } catch (_) {}
      if (visibilityChangeListener) {
        try {
          visibilityChangeListener.stop()
        } catch (_) {}
      }
      while (restoreHandlers.length) {
        var restoreHandler = restoreHandlers.pop()
        try {
          restoreHandler()
        } catch (_) {}
      }
      extensionPatchRecords = []
      extensionContextByObject = new WeakMap()
    },
    reset: function () {
      resetSchedulerState()
    }
  }
}
