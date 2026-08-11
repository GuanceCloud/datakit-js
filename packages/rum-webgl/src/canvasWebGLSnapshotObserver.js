function noop() {}

function addEventListener(eventTarget, event, listener, options) {
  var capture = !!(options && options.capture)
  eventTarget.addEventListener(event, listener, capture)
  return {
    stop: function () {
      eventTarget.removeEventListener(event, listener, capture)
    }
  }
}

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
var DEFAULT_WEBGL_BOOTSTRAP_LEASE_MS = 30000
var activeWebGLObserverTokens = []
var nextWebGLObserverToken = 0
var webGLBootstrapMethodPatchRecords = []
var webGLBootstrapExtensionPatchRecords = []
var registeredExtensionPatchCount = 0
var bootstrapContextTypeByCanvas = new WeakMap()
var webGLExtensionContextByObject = new WeakMap()
var registeredExtensionDrawOwners = []
var webGLBootstrapLeaseTimerId
var clearWebGLBootstrapLeaseTimer = noop

function cancelCanvasWebGLSnapshotBootstrapLease() {
  if (webGLBootstrapLeaseTimerId === undefined) {
    return
  }
  try {
    clearWebGLBootstrapLeaseTimer(webGLBootstrapLeaseTimerId)
  } catch (_) {}
  webGLBootstrapLeaseTimerId = undefined
  clearWebGLBootstrapLeaseTimer = noop
}

function scheduleCanvasWebGLSnapshotBootstrapLease(options) {
  var leaseDuration =
    typeof options.bootstrapLeaseDuration === 'number'
      ? Math.max(options.bootstrapLeaseDuration, 0)
      : DEFAULT_WEBGL_BOOTSTRAP_LEASE_MS
  var setTimeoutImpl = options.setTimeoutImpl || setTimeout
  var clearTimeoutImpl = options.clearTimeoutImpl || clearTimeout
  cancelCanvasWebGLSnapshotBootstrapLease()
  clearWebGLBootstrapLeaseTimer = clearTimeoutImpl
  webGLBootstrapLeaseTimerId = setTimeoutImpl(function () {
    webGLBootstrapLeaseTimerId = undefined
    clearWebGLBootstrapLeaseTimer = noop
    if (!activeWebGLObserverTokens.length) {
      restoreCanvasWebGLSnapshotBootstrap()
    }
  }, leaseDuration)
}

function getActiveWebGLObserverToken() {
  return activeWebGLObserverTokens.length
    ? activeWebGLObserverTokens[activeWebGLObserverTokens.length - 1]
    : undefined
}

function removeActiveWebGLObserverToken(token) {
  var tokenIndex = activeWebGLObserverTokens.indexOf(token)
  if (tokenIndex !== -1) {
    activeWebGLObserverTokens.splice(tokenIndex, 1)
  }
}

export function normalizeCanvasWebGLSnapshotContextType(contextType) {
  if (typeof contextType !== 'string') {
    return
  }
  var normalizedContextType = contextType.toLowerCase()
  if (normalizedContextType === 'experimental-webgl') {
    return 'webgl'
  }
  if (
    normalizedContextType === '2d' ||
    normalizedContextType === 'webgl' ||
    normalizedContextType === 'webgl2'
  ) {
    return normalizedContextType
  }
}

export function getCanvasWebGLSnapshotContextType(canvas) {
  return canvas ? bootstrapContextTypeByCanvas.get(canvas) : undefined
}

function getRegisteredExtensionDrawOwner(record) {
  return record[2] ? record[0].deref() : record[0]
}

function registerExtensionDrawOwner(owner, methodName) {
  var nextRecords = []
  var matchingRecord
  registeredExtensionDrawOwners.forEach(function (record) {
    var registeredOwner = getRegisteredExtensionDrawOwner(record)
    if (!registeredOwner) {
      return
    }
    if (registeredOwner === owner && record[1] === methodName) {
      matchingRecord = record
      return
    }
    nextRecords.push(record)
  })

  if (!matchingRecord) {
    var canUseWeakRef = typeof WeakRef === 'function'
    matchingRecord = [
      canUseWeakRef ? new WeakRef(owner) : owner,
      methodName,
      canUseWeakRef
    ]
  }
  nextRecords.push(matchingRecord)
  if (nextRecords.length > MAX_WEBGL_EXTENSION_PATCH_RECORDS) {
    nextRecords.shift()
  }
  registeredExtensionDrawOwners = nextRecords
}

function forEachRegisteredExtensionDrawOwner(callback) {
  var liveRecords = []
  registeredExtensionDrawOwners.forEach(function (record) {
    var owner = getRegisteredExtensionDrawOwner(record)
    if (!owner) {
      return
    }
    liveRecords.push(record)
    callback(owner, record[1])
  })
  registeredExtensionDrawOwners = liveRecords
}

function isWebGLSnapshotRecordingEnabled(configuration) {
  return (
    configuration.replayCanvasEnabled &&
    configuration.replayCanvasMode === 'auto'
  )
}

function isDocumentHidden(getVisibilityState) {
  return getVisibilityState() === 'hidden'
}

function isWebGLContextType(contextType) {
  return contextType === 'webgl' || contextType === 'webgl2'
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
  return Math.min(
    interval *
      Math.min(
        Math.ceil(
          mainThreadCaptureDuration / WEBGL_MAIN_THREAD_CAPTURE_BUDGET
        ),
        MAX_WEBGL_ADAPTIVE_INTERVAL_FACTOR
      ),
    MAX_WEBGL_SNAPSHOT_INTERVAL
  )
}

function getWebGLSnapshotCooldown(configuration, result) {
  if (!result || result.ok !== false) {
    return configuration.replayCanvasAutoCooldown || 0
  }
  if (
    result.reason === 'not_serialized' ||
    result.reason === 'dimension_mutation_flush_failed'
  ) {
    return 0
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
      contextType: 'webgl',
      prototype: window.WebGLRenderingContext.prototype
    })
  }
  if (
    typeof window.WebGL2RenderingContext === 'function' &&
    window.WebGL2RenderingContext.prototype
  ) {
    entries.push({
      contextType: 'webgl2',
      prototype: window.WebGL2RenderingContext.prototype
    })
  }
  return entries
}

function getRequiredFunction(options, name) {
  if (typeof options[name] !== 'function') {
    throw new Error('WebGL replay observer requires ' + name)
  }
  return options[name]
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

function patchMethod(target, methodName, createWrapper, patchRecords) {
  target = getMethodOwner(target, methodName)
  if (
    !target ||
    (patchRecords &&
      patchRecords.some(function (record) {
        return record[0] === target && record[1] === methodName
      }))
  ) {
    return
  }
  var descriptor = Object.getOwnPropertyDescriptor(target, methodName)
  if (!descriptor || typeof descriptor.value !== 'function') {
    return
  }
  var wrappedMethod = createWrapper(descriptor.value)
  try {
    Object.defineProperty(
      target,
      methodName,
      {
        configurable: descriptor.configurable,
        enumerable: descriptor.enumerable,
        writable: descriptor.writable,
        value: wrappedMethod
      }
    )
  } catch (_) {
    return
  }
  var patchRecord = [target, methodName, wrappedMethod, descriptor]
  if (patchRecords) {
    patchRecords.push(patchRecord)
  }
  return patchRecord
}

function isMethodPatchCurrent(record) {
  try {
    var descriptor = Object.getOwnPropertyDescriptor(record[0], record[1])
    return Boolean(descriptor && descriptor.value === record[2])
  } catch (_) {
    return false
  }
}

function restoreMethodPatch(record) {
  if (!isMethodPatchCurrent(record)) {
    return
  }
  try {
    Object.defineProperty(record[0], record[1], record[3])
  } catch (_) {}
}

function patchDrawMethod(target, methodName, contextType, patchRecords) {
  return patchMethod(
    target,
    methodName,
    function (originalMethod) {
      return function () {
        var result = originalMethod.apply(this, arguments)
        var observerToken = getActiveWebGLObserverToken()
        if (observerToken) {
          observerToken.$rOnDraw(this, contextType)
        }
        return result
      }
    },
    patchRecords
  )
}

function patchGetExtension(target, contextType, patchRecords) {
  return patchMethod(
    target,
    'getExtension',
    function (originalGetExtension) {
      return function () {
        var extension = originalGetExtension.apply(this, arguments)
        if (extension) {
          observeWebGLExtension(extension, this, contextType)
        }
        return extension
      }
    },
    patchRecords
  )
}

function patchCanvasGetContext(canvasPrototype, patchRecords) {
  return patchMethod(
    canvasPrototype,
    'getContext',
    function (originalGetContext) {
      return function (contextType) {
        var context = originalGetContext.apply(this, arguments)
        var normalizedContextType = normalizeCanvasWebGLSnapshotContextType(
          contextType
        )
        if (context && normalizedContextType) {
          bootstrapContextTypeByCanvas.set(this, normalizedContextType)
          var observerToken = getActiveWebGLObserverToken()
          if (observerToken) {
            observerToken.$rOnContext(this, normalizedContextType)
          }
        }
        return context
      }
    },
    patchRecords
  )
}

function patchRequestAnimationFrame(animationFrameTarget, patchRecords) {
  return patchMethod(
    animationFrameTarget,
    'requestAnimationFrame',
    function (originalRequestAnimationFrame) {
      return function (callback) {
        if (typeof callback !== 'function') {
          return originalRequestAnimationFrame.apply(this, arguments)
        }
        if (!getActiveWebGLObserverToken()) {
          return originalRequestAnimationFrame.apply(this, arguments)
        }
        return originalRequestAnimationFrame.call(this, function (timestamp) {
          var observerToken = getActiveWebGLObserverToken()
          if (!observerToken) {
            return callback.call(this, timestamp)
          }
          observerToken.$rOnAnimationFrameStarted(timestamp)
          try {
            return callback.call(this, timestamp)
          } finally {
            observerToken.$rOnAnimationFrameCompleted(timestamp)
          }
        })
      }
    },
    patchRecords
  )
}

function installExtensionDrawPatch(target, methodName, rememberOwner) {
  for (
    var recordIndex = 0;
    recordIndex < webGLBootstrapExtensionPatchRecords.length;
    recordIndex += 1
  ) {
    var existingRecord = webGLBootstrapExtensionPatchRecords[recordIndex]
    if (
      existingRecord[0] !== target ||
      existingRecord[1] !== methodName
    ) {
      continue
    }
    if (isMethodPatchCurrent(existingRecord)) {
      if (rememberOwner) {
        if (recordIndex < registeredExtensionPatchCount) {
          registeredExtensionPatchCount -= 1
          webGLBootstrapExtensionPatchRecords[recordIndex] =
            webGLBootstrapExtensionPatchRecords[registeredExtensionPatchCount]
          webGLBootstrapExtensionPatchRecords[registeredExtensionPatchCount] =
            existingRecord
        }
        registerExtensionDrawOwner(target, methodName)
      }
      return true
    }
    webGLBootstrapExtensionPatchRecords.splice(recordIndex, 1)
    if (recordIndex < registeredExtensionPatchCount) {
      registeredExtensionPatchCount -= 1
    }
    break
  }

  if (
    webGLBootstrapExtensionPatchRecords.length >=
    MAX_WEBGL_EXTENSION_PATCH_RECORDS
  ) {
    if (!rememberOwner || !registeredExtensionPatchCount) {
      return false
    }
    restoreMethodPatch(webGLBootstrapExtensionPatchRecords.shift())
    registeredExtensionPatchCount -= 1
  }
  var patchRecord = patchMethod(
    target,
    methodName,
    function (originalMethod) {
      return function () {
        var result = originalMethod.apply(this, arguments)
        var observerToken = getActiveWebGLObserverToken()
        if (observerToken) {
          var contextState = webGLExtensionContextByObject.get(this)
          if (contextState) {
            observerToken.$rOnDraw(
              contextState.$rContext,
              contextState.$rContextType
            )
          }
        }
        return result
      }
    }
  )
  if (!patchRecord) {
    return false
  }
  webGLBootstrapExtensionPatchRecords.push(patchRecord)
  if (rememberOwner) {
    registerExtensionDrawOwner(target, methodName)
  }
  return true
}

function observeWebGLExtension(extension, context, contextType) {
  webGLExtensionContextByObject.set(extension, {
    $rContext: context,
    $rContextType: contextType
  })
  WEBGL_EXTENSION_DRAW_METHODS.forEach(function (methodName) {
    var methodOwner = getMethodOwner(extension, methodName)
    if (methodOwner) {
      installExtensionDrawPatch(methodOwner, methodName, true)
    }
  })
}

function restoreCanvasWebGLSnapshotBootstrap() {
  cancelCanvasWebGLSnapshotBootstrapLease()
  while (webGLBootstrapExtensionPatchRecords.length) {
    restoreMethodPatch(webGLBootstrapExtensionPatchRecords.pop())
  }
  registeredExtensionPatchCount = 0
  while (webGLBootstrapMethodPatchRecords.length) {
    restoreMethodPatch(webGLBootstrapMethodPatchRecords.pop())
  }
}

export function installCanvasWebGLSnapshotBootstrap(options) {
  // This must run before an engine caches GL/rAF methods. JavaScript cannot
  // replace a native function reference that application code cached earlier.
  options = options || {}
  var contextPrototypeEntries =
    options.contextPrototypeEntries || getDefaultContextPrototypeEntries()
  var canvasPrototype =
    options.canvasPrototype ||
    (window.HTMLCanvasElement && window.HTMLCanvasElement.prototype)
  var animationFrameTarget =
    options.animationFrameTarget === undefined
      ? window
      : options.animationFrameTarget

  forEachRegisteredExtensionDrawOwner(function (owner, methodName) {
    installExtensionDrawPatch(owner, methodName, false)
  })
  registeredExtensionPatchCount =
    webGLBootstrapExtensionPatchRecords.length

  contextPrototypeEntries.forEach(function (entry) {
    WEBGL_DRAW_METHODS.forEach(function (methodName) {
      patchDrawMethod(
        entry.prototype,
        methodName,
        entry.contextType,
        webGLBootstrapMethodPatchRecords
      )
    })
    patchGetExtension(
      entry.prototype,
      entry.contextType,
      webGLBootstrapMethodPatchRecords
    )
  })
  patchCanvasGetContext(
    canvasPrototype,
    webGLBootstrapMethodPatchRecords
  )
  patchRequestAnimationFrame(
    animationFrameTarget,
    webGLBootstrapMethodPatchRecords
  )
  if (options.bootstrapLeaseDuration !== undefined) {
    scheduleCanvasWebGLSnapshotBootstrapLease(options)
  }
}

export function startCanvasWebGLSnapshotObserver(options) {
  var configuration = options.configuration
  if (!isWebGLSnapshotRecordingEnabled(configuration)) {
    cancelCanvasWebGLSnapshotBootstrapLease()
    if (!activeWebGLObserverTokens.length) {
      restoreCanvasWebGLSnapshotBootstrap()
    }
    return {
      isWebGLCanvas: function (canvas) {
        return isWebGLContextType(
          bootstrapContextTypeByCanvas.get(canvas)
        )
      },
      stop: noop,
      reset: noop
    }
  }

  var getCanvasContextType = getRequiredFunction(
    options,
    'hostGetCanvasContextType'
  )
  var setCanvasContextType = getRequiredFunction(
    options,
    'hostSetCanvasContextType'
  )
  var normalizeCanvasContextType = getRequiredFunction(
    options,
    'hostNormalizeCanvasContextType'
  )
  var isInternalCanvas = getRequiredFunction(
    options,
    'hostIsInternalCanvas'
  )
  var shouldRecordCanvas = getRequiredFunction(
    options,
    'hostShouldRecordCanvas'
  )
  var snapshotCanvas = getRequiredFunction(options, 'hostSnapshotCanvas')
  var onDebug = options.hostOnDebug || noop
  var now = options.now || Date.now
  var getCurrentTime = options.getCurrentTime || getDefaultCurrentTime
  var getSerializedNodeId = options.hostGetSerializedNodeId || noop
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
  var addEventListenerImpl = options.addEventListenerImpl || addEventListener
  var stateByCanvas = new WeakMap()
  var stateByContext = new WeakMap()
  var pendingCanvases = []
  var pendingDrainScheduled = false
  var activeSnapshotCount = 0
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
    Math.min(maxSnapshotsPerRun, MAX_WEBGL_CONCURRENT_SNAPSHOTS)
  )
  var maxQueuedCanvases = Math.max(maxSnapshotsPerRun * 2, 50)
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
        $rLastSelectedSequence: 0,
        nextEligibleAt: 0,
        $rContextType: undefined,
        $rPriority: undefined
      }
      stateByCanvas.set(canvas, state)
    }
    return state
  }

  function getContextTypeForDraw(context, contextType) {
    var knownType =
      context && context.canvas
        ? getCanvasContextType(context.canvas) ||
          bootstrapContextTypeByCanvas.get(context.canvas)
        : undefined
    if (knownType) {
      return knownType
    }
    try {
      if (
        typeof window.WebGL2RenderingContext === 'function' &&
        context instanceof window.WebGL2RenderingContext
      ) {
        return 'webgl2'
      }
    } catch (_) {}
    return contextType
  }

  function isCanvasAllowedByConfiguration(canvas, state) {
    var decision = shouldRecordCanvas(canvas)
    state.$rPriority =
      typeof decision === 'number' && isFinite(decision)
        ? decision
        : undefined
    return decision !== false
  }

  function notifySnapshotResult(
    canvas,
    state,
    startedAt,
    completedAt,
    result
  ) {
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
          priority: state.$rPriority
        }
      ]
    })
  }

  function scheduleQueueDrain() {
    // This is scheduled only by enqueueCanvas() during a real draw. Never
    // call it from cooldown timers or encode completion: the default WebGL
    // framebuffer may no longer contain that draw at an async boundary.
    if (
      stopped ||
      pendingDrainScheduled ||
      !pendingCanvases.length ||
      animationFrameCallbackDepth > 0
    ) {
      return
    }
    pendingDrainScheduled = true
    var drainGeneration = generation
    scheduleMicrotask(function () {
      pendingDrainScheduled = false
      if (!stopped && drainGeneration === generation) {
        drainSnapshotQueue()
      }
    })
  }

  function drainQueueAtAnimationFrameBoundary() {
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
    drainSnapshotQueue()
  }

  function enqueueCanvas(canvas, state) {
    if (stopped || state.$rQueued || state.$rInFlight) {
      return false
    }
    if (pendingCanvases.length >= maxQueuedCanvases) {
      return false
    }
    state.$rQueued = true
    pendingCanvases.push({
      $rCanvas: canvas,
      $rState: state,
      $rGeneration: generation
    })
    scheduleQueueDrain()
    return true
  }

  function runSnapshot(canvas, state, contextType, scheduledGeneration) {
    if (
      stopped ||
      scheduledGeneration !== generation ||
      isDocumentHidden(getVisibilityState) ||
      state.$rInFlight ||
      !state.$rDirty
    ) {
      state.$rDirty = false
      return 0
    }
    if (!isCanvasAllowedByConfiguration(canvas, state)) {
      state.$rDirty = false
      return 0
    }

    var startedAt = now()
    state.$rDirty = false
    state.$rInFlight = true
    selectionSequence += 1
    state.$rLastSelectedSequence = selectionSequence
    activeSnapshotCount += 1
    var snapshotResult
    var mainThreadCaptureStartedAt = getCurrentTime()
    var mainThreadCaptureDuration
    try {
      var snapshotOptions = {
        trigger: 'auto',
        scheduler: 'webgl_snapshot',
        contextType: contextType
      }
      snapshotResult = snapshotCanvas(canvas, snapshotOptions)
    } catch (_) {
      snapshotResult = { ok: false, reason: 'encode_failed' }
    } finally {
      mainThreadCaptureDuration = Math.max(
        getCurrentTime() - mainThreadCaptureStartedAt,
        0
      )
    }

    Promise.resolve(snapshotResult)
      .catch(function () {
        return { ok: false, reason: 'encode_failed' }
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
        notifySnapshotResult(
          canvas,
          state,
          startedAt,
          completedAt,
          result
        )
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
      queuedCanvas.$rState.$rQueued = false
      queuedCanvas.$rState.$rDirty = false
    }
  }

  function drainSnapshotQueue() {
    if (stopped || isDocumentHidden(getVisibilityState)) {
      dropPendingCanvasFrames()
      return
    }
    var selectedCount = 0
    var synchronousCaptureDuration = 0
    var pendingInspectionCount = pendingCanvases.length
    if (pendingInspectionCount > 1) {
      pendingCanvases.sort(function (left, right) {
        var priorityDifference =
          (right.$rState.$rPriority || 0) -
          (left.$rState.$rPriority || 0)
        if (priorityDifference) {
          return priorityDifference
        }
        return (
          left.$rState.$rLastSelectedSequence -
          right.$rState.$rLastSelectedSequence
        )
      })
    }
    while (
      activeSnapshotCount < maxConcurrentSnapshots &&
      selectedCount < maxSnapshotsPerRun &&
      pendingCanvases.length &&
      pendingInspectionCount > 0
    ) {
      var queuedCanvas = pendingCanvases.shift()
      pendingInspectionCount -= 1
      var state = queuedCanvas.$rState
      state.$rQueued = false
      if (
        queuedCanvas.$rGeneration !== generation ||
        !state.$rDirty
      ) {
        continue
      }
      if (now() < state.nextEligibleAt) {
        continue
      }
      selectedCount += 1
      synchronousCaptureDuration += runSnapshot(
        queuedCanvas.$rCanvas,
        state,
        state.$rContextType,
        queuedCanvas.$rGeneration
      )
      if (
        synchronousCaptureDuration >= WEBGL_MAIN_THREAD_CAPTURE_BUDGET
      ) {
        break
      }
    }
    while (pendingCanvases.length) {
      pendingCanvases.shift().$rState.$rQueued = false
    }
  }

  function onDraw(context, contextType) {
    if (stopped) {
      return
    }
    var state = stateByContext.get(context)
    var canvas = context && context.canvas
    if (
      !canvas ||
      isInternalCanvas(canvas) ||
      (typeof HTMLCanvasElement !== 'undefined' &&
        !(canvas instanceof HTMLCanvasElement))
    ) {
      return
    }

    contextType = getContextTypeForDraw(context, contextType)
    if (!state) {
      state = getCanvasState(canvas)
      stateByContext.set(context, state)
    }
    if (state.$rContextType !== contextType) {
      state.$rContextType = contextType
      setCanvasContextType(canvas, contextType)
    }
    if (isDocumentHidden(getVisibilityState)) {
      state.$rDirty = false
      return
    }
    state.$rDirty = true
    if (state.$rQueued || state.$rInFlight) {
      return
    }
    var currentTime = now()
    if (currentTime < state.nextEligibleAt) {
      return
    }
    if (activeSnapshotCount >= maxConcurrentSnapshots) {
      return
    }
    if (!isCanvasAllowedByConfiguration(canvas, state)) {
      state.$rDirty = false
      return
    }
    enqueueCanvas(canvas, state)
  }

  function resetSchedulerState() {
    generation += 1
    selectionSequence = 0
    pendingCanvases = []
    pendingDrainScheduled = false
    stateByCanvas = new WeakMap()
    stateByContext = new WeakMap()
  }

  var observerToken = {
    $rId: ++nextWebGLObserverToken,
    $rOnDraw: onDraw,
    $rOnContext: function (canvas, contextType) {
      var normalizedContextType = normalizeCanvasContextType(contextType)
      if (normalizedContextType) {
        bootstrapContextTypeByCanvas.set(canvas, normalizedContextType)
        setCanvasContextType(canvas, normalizedContextType)
      }
    },
    $rOnAnimationFrameStarted: function () {
      animationFrameCallbackDepth += 1
    },
    $rOnAnimationFrameCompleted: drainQueueAtAnimationFrameBoundary
  }

  cancelCanvasWebGLSnapshotBootstrapLease()
  try {
    installCanvasWebGLSnapshotBootstrap({
      contextPrototypeEntries: options.contextPrototypeEntries,
      canvasPrototype: options.canvasPrototype,
      animationFrameTarget: options.animationFrameTarget
    })

    visibilityChangeListener = addEventListenerImpl(
      document,
      'visibilitychange',
      function () {
        if (isDocumentHidden(getVisibilityState)) {
          resetSchedulerState()
        }
      },
      { capture: true }
    )
    activeWebGLObserverTokens.push(observerToken)
  } catch (error) {
    if (!activeWebGLObserverTokens.length) {
      restoreCanvasWebGLSnapshotBootstrap()
    }
    throw error
  }

  return {
    isWebGLCanvas: function (canvas) {
      var contextType =
        getCanvasContextType(canvas) ||
        bootstrapContextTypeByCanvas.get(canvas)
      return isWebGLContextType(contextType)
    },
    stop: function () {
      if (stopped) {
        return
      }
      stopped = true
      removeActiveWebGLObserverToken(observerToken)
      try {
        resetSchedulerState()
      } catch (_) {}
      if (visibilityChangeListener) {
        try {
          visibilityChangeListener.stop()
        } catch (_) {}
      }
      if (!activeWebGLObserverTokens.length) {
        restoreCanvasWebGLSnapshotBootstrap()
      }
    },
    reset: resetSchedulerState
  }
}
