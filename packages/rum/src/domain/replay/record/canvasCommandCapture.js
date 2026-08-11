import { createCanvasCommandObjectRefRegistry } from './canvasCommandSerializeArgs'
import { createCanvasMutationRecord } from './canvasMutationRecord'

var CANVAS_2D_CAPTURED_METHODS = [
  'save',
  'restore',
  'translate',
  'scale',
  'rotate',
  'transform',
  'setTransform',
  'resetTransform',
  'reset',
  'createLinearGradient',
  'createRadialGradient',
  'createPattern',
  'createConicGradient',
  'clearRect',
  'fillRect',
  'strokeRect',
  'rect',
  'beginPath',
  'moveTo',
  'lineTo',
  'bezierCurveTo',
  'quadraticCurveTo',
  'arcTo',
  'closePath',
  'arc',
  'ellipse',
  'roundRect',
  'clip',
  'fill',
  'stroke',
  'fillText',
  'strokeText',
  'setLineDash',
  'putImageData',
  'drawImage'
]

var CANVAS_2D_CAPTURED_PROPERTIES = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'lineDashOffset',
  'font',
  'globalAlpha',
  'globalCompositeOperation',
  'imageSmoothingEnabled',
  'imageSmoothingQuality',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'textAlign',
  'textBaseline',
  'direction',
  'fontKerning',
  'fontStretch',
  'fontVariantCaps',
  'letterSpacing',
  'textRendering',
  'wordSpacing',
  'filter'
]

var CANVAS_2D_NON_MUTATING_METHODS = {
  createImageData: true,
  getContextAttributes: true,
  getImageData: true,
  getLineDash: true,
  getTransform: true,
  isContextLost: true,
  isPointInPath: true,
  isPointInStroke: true,
  measureText: true
}
var CANVAS_2D_CAPTURED_METHOD_NAMES = {}
var CANVAS_2D_CAPTURED_PROPERTY_NAMES = {}
CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
  CANVAS_2D_CAPTURED_METHOD_NAMES[methodName] = true
})
CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
  CANVAS_2D_CAPTURED_PROPERTY_NAMES[propertyName] = true
})

var UNSUPPORTED_REPLAY_OBJECT_NAMES = {
  CanvasGradient: true,
  CanvasPattern: true,
  Path2D: true
}
export var MAX_CANVAS_COMMANDS_PER_BATCH = 1000
export var MAX_CANVAS_COMMAND_BATCH_BYTES = 128 * 1024
export var MAX_PENDING_CANVAS_COMMAND_CONTEXTS = 64
export var MAX_PENDING_CANVAS_COMMAND_BYTES = 512 * 1024
export var MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS = 1000
export var MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS = 64
export var MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS = 256
var MAX_PATCHED_CANVAS_PROTOTYPE_RECORDS = 16

var CANVAS_COMMAND_BASE_APPROX_BYTES = 32
var CANVAS_COMMAND_SETTER_APPROX_BYTES = 14
var ORIGINAL_ADD_COLOR_STOP_KEY = '__dd_original_addColorStop__'
var PATCHED_ADD_COLOR_STOP_KEY = '__dd_patched_addColorStop__'

function canPatchProperty(target, property) {
  var descriptor = Object.getOwnPropertyDescriptor(target, property)
  return !descriptor || descriptor.configurable !== false
}

function getPropertyDescriptor(target, property) {
  var currentTarget = target
  while (currentTarget) {
    var descriptor = Object.getOwnPropertyDescriptor(currentTarget, property)
    if (descriptor) {
      return descriptor
    }
    currentTarget = Object.getPrototypeOf(currentTarget)
  }
}

function getCanvasObjectConstructorName(value) {
  if (!value || typeof value !== 'object' || !value.constructor) {
    return
  }
  return value.constructor.name || 'Object'
}

function getFallbackReasonForConstructorName(constructorName) {
  if (constructorName === 'CanvasGradient') {
    return 'gradient_style_assignment'
  }
  if (constructorName === 'CanvasPattern') {
    return 'canvas_pattern'
  }
  if (constructorName === 'Path2D') {
    return 'path2d_argument'
  }
  return 'unsupported_canvas_object'
}

function addApproxBytes(state, bytes) {
  if (
    !isFinite(bytes) ||
    bytes < 0 ||
    bytes > state.limit - state.bytes
  ) {
    state.overflow = true
    return false
  }
  state.bytes += bytes
  return true
}

function addStringApproxBytes(state, value) {
  if (!addApproxBytes(state, 2)) {
    return
  }
  for (var index = 0; index < value.length && !state.overflow; index += 1) {
    var code = value.charCodeAt(index)
    if (code === 0x22 || code === 0x5c) {
      addApproxBytes(state, 2)
    } else if (code <= 0x1f) {
      addApproxBytes(state, 6)
    } else if (code <= 0x7f) {
      addApproxBytes(state, 1)
    } else if (code <= 0x7ff) {
      addApproxBytes(state, 2)
    } else if (code >= 0xd800 && code <= 0xdbff) {
      var nextCode = value.charCodeAt(index + 1)
      if (nextCode >= 0xdc00 && nextCode <= 0xdfff) {
        index += 1
        addApproxBytes(state, 4)
      } else {
        addApproxBytes(state, 6)
      }
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      addApproxBytes(state, 6)
    } else {
      addApproxBytes(state, 3)
    }
  }
}

function addPrimitiveApproxBytes(state, value) {
  if (value === null || value === undefined) {
    addApproxBytes(state, 4)
    return true
  }
  if (typeof value === 'string') {
    addStringApproxBytes(state, value)
    return true
  }
  if (typeof value === 'number') {
    addApproxBytes(
      state,
      isFinite(value) ? String(value).length : 4
    )
    return true
  }
  if (typeof value === 'boolean') {
    addApproxBytes(state, value ? 4 : 5)
    return true
  }
  if (typeof value === 'function' || typeof value === 'symbol') {
    addApproxBytes(state, 4)
    return true
  }
  if (typeof value === 'bigint') {
    throw new Error('Unsupported canvas command bigint argument')
  }
  return false
}

function getTypedArrayElementApproxBytes(value) {
  var constructorName = getCanvasObjectConstructorName(value)
  if (
    constructorName === 'Uint8Array' ||
    constructorName === 'Uint8ClampedArray'
  ) {
    return 4
  }
  if (constructorName === 'Int8Array') {
    return 5
  }
  if (constructorName === 'Uint16Array') {
    return 6
  }
  if (constructorName === 'Int16Array') {
    return 7
  }
  if (constructorName === 'Uint32Array') {
    return 11
  }
  if (constructorName === 'Int32Array') {
    return 12
  }
  return 25
}

function isSerializedTypedArray(value) {
  return (
    value instanceof Float32Array ||
    value instanceof Float64Array ||
    value instanceof Int32Array ||
    value instanceof Uint32Array ||
    value instanceof Uint8Array ||
    value instanceof Uint16Array ||
    value instanceof Int16Array ||
    value instanceof Int8Array ||
    value instanceof Uint8ClampedArray
  )
}

function addTypedArrayApproxBytes(state, value) {
  var elementCount = value.length
  var perElementBytes = getTypedArrayElementApproxBytes(value)
  addApproxBytes(
    state,
    32 +
      (elementCount ? elementCount * perElementBytes + elementCount - 1 : 0)
  )
}

function addArrayBufferApproxBytes(state, buffer) {
  addApproxBytes(state, 36 + Math.ceil(buffer.byteLength / 3) * 4)
}

function estimateCanvasCommand(property, args, setter, limit) {
  var state = {
    bytes: 0,
    fallbackReason: undefined,
    limit: limit,
    overflow: false
  }
  addApproxBytes(
    state,
    CANVAS_COMMAND_BASE_APPROX_BYTES +
      (setter ? CANVAS_COMMAND_SETTER_APPROX_BYTES : 0)
  )
  addStringApproxBytes(state, property)
  if (state.overflow) {
    return state
  }

  var argCount = args.length
  var minimumArgsBytes =
    2 + (argCount ? argCount - 1 + argCount : 0)
  if (minimumArgsBytes > state.limit - state.bytes) {
    state.overflow = true
    return state
  }
  addApproxBytes(state, 2 + (argCount ? argCount - 1 : 0))

  var firstComplexArgIndex = argCount
  for (
    var primitiveArgIndex = 0;
    primitiveArgIndex < argCount && !state.overflow;
    primitiveArgIndex += 1
  ) {
    if (!addPrimitiveApproxBytes(state, args[primitiveArgIndex])) {
      firstComplexArgIndex = primitiveArgIndex
      break
    }
  }
  if (
    state.overflow ||
    firstComplexArgIndex === argCount
  ) {
    return state
  }

  var seenArrays
  var stack = []
  for (
    var argIndex = argCount - 1;
    argIndex >= firstComplexArgIndex;
    argIndex -= 1
  ) {
    stack.push({ type: 'value', value: args[argIndex] })
  }

  while (stack.length && !state.overflow && !state.fallbackReason) {
    var task = stack.pop()
    if (task.type === 'array') {
      if (task.index >= task.value.length) {
        if (seenArrays) {
          seenArrays.delete(task.value)
        }
        continue
      }
      var arrayIndex = task.index
      task.index += 1
      stack.push(task)
      stack.push({
        type: 'value',
        value:
          arrayIndex in task.value
            ? task.value[arrayIndex]
            : undefined
      })
      continue
    }

    var value = task.value
    if (addPrimitiveApproxBytes(state, value)) {
      continue
    }
    if (Array.isArray(value)) {
      if (seenArrays && seenArrays.has(value)) {
        throw new Error('Circular canvas command argument')
      }
      var arrayLength = value.length
      var minimumArrayBytes =
        2 + (arrayLength ? arrayLength - 1 + arrayLength : 0)
      if (minimumArrayBytes > state.limit - state.bytes) {
        state.overflow = true
        break
      }
      addApproxBytes(
        state,
        2 + (arrayLength ? arrayLength - 1 : 0)
      )
      if (!seenArrays) {
        seenArrays = new WeakSet()
      }
      seenArrays.add(value)
      stack.push({ type: 'array', value: value, index: 0 })
      continue
    }

    if (
      typeof HTMLCanvasElement !== 'undefined' &&
      value instanceof HTMLCanvasElement
    ) {
      state.fallbackReason = 'canvas_element_argument'
      break
    }

    var constructorName = getCanvasObjectConstructorName(value)
    if (
      constructorName &&
      UNSUPPORTED_REPLAY_OBJECT_NAMES[constructorName]
    ) {
      state.fallbackReason =
        getFallbackReasonForConstructorName(constructorName)
      break
    }

    if (isSerializedTypedArray(value)) {
      addTypedArrayApproxBytes(state, value)
      continue
    }
    if (value instanceof ArrayBuffer) {
      addArrayBufferApproxBytes(state, value)
      continue
    }
    if (value instanceof DataView) {
      addArrayBufferApproxBytes(state, value.buffer)
      addApproxBytes(state, 32)
      continue
    }
    if (
      typeof ImageData !== 'undefined' &&
      value instanceof ImageData
    ) {
      addTypedArrayApproxBytes(state, value.data)
      addApproxBytes(state, 32)
      continue
    }
    if (
      typeof HTMLImageElement !== 'undefined' &&
      value instanceof HTMLImageElement
    ) {
      addApproxBytes(state, 36)
      addStringApproxBytes(state, value.currentSrc || value.src || '')
      continue
    }

    // rrweb can only resolve object references that were produced by a
    // previous replayed canvas command. Arbitrary platform objects such as
    // DOMMatrix, ImageBitmap or VideoFrame would otherwise become dangling
    // { rr_type, index } references and change the replayed draw semantics.
    state.fallbackReason = 'unsupported_canvas_object'
  }

  return state
}

function isCrossOriginImageElement(value) {
  if (typeof HTMLImageElement === 'undefined' || !(value instanceof HTMLImageElement)) {
    return false
  }
  var src = value.currentSrc || value.src
  if (!src) {
    return false
  }
  if (src.indexOf('data:') === 0 || src.indexOf('blob:') === 0) {
    return false
  }
  try {
    return new URL(src, window.location.href).origin !== window.location.origin
  } catch (_) {
    return false
  }
}

function isUnsupportedDrawImageSource(value) {
  if (
    typeof HTMLImageElement !== 'undefined' &&
    value instanceof HTMLImageElement
  ) {
    var imageSource = value.currentSrc || value.src || ''
    if (
      imageSource.indexOf('blob:') === 0 ||
      imageSource.indexOf('filesystem:') === 0
    ) {
      return 'draw_image_unsupported_source'
    }
    return isCrossOriginImageElement(value)
      ? 'draw_image_cross_origin'
      : undefined
  }
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
    return 'draw_image_canvas'
  }
  if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) {
    return 'draw_image_video'
  }
  // HTMLImageElement is the only CanvasImageSource that the replay player can
  // recreate independently. ImageBitmap, OffscreenCanvas, VideoFrame and SVG
  // image sources would otherwise be serialized as object references without
  // a matching producer command and replay as drawImage(undefined, ...).
  return 'draw_image_unsupported_source'
}

export function createCanvas2DCommandRecorder(options) {
  options = options || {}
  var emit = options.emit || function () {}
  var now = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.now || Date.now
    : Date.now
  var requestAnimationFrameImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
      options.requestAnimationFrameImpl) ||
    function (callback) {
      return window.requestAnimationFrame(callback)
    }
  var cancelAnimationFrameImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
      options.cancelAnimationFrameImpl) ||
    function (rafId) {
      return window.cancelAnimationFrame(rafId)
    }
  var setTimeoutImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.setTimeoutImpl) ||
    function (callback, delay) {
      return setTimeout(callback, delay)
    }
  var clearTimeoutImpl =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.clearTimeoutImpl) ||
    function (timeoutId) {
      return clearTimeout(timeoutId)
    }

  var trackedContexts = []
  var trackedContextSet = new WeakSet()
  var captureGenerationByContext = new WeakMap()
  var captureGeneration = 0
  var rejectedContextSet = new WeakSet()
  var patchedPrototypeRecords = []
  var snapshotFallbackPatchTargets = new WeakSet()
  var pendingCommandsByContext = new Map()
  var pendingCommandApproxBytes = 0
  var fallbackModeContexts = new WeakSet()
  var persistentFallbackModeContexts = new WeakSet()
  var fallbackReasonByContext = new WeakMap()
  var persistentFallbackReasonByContext = new WeakMap()
  var expiredUnpublishedContexts = new WeakSet()
  var patchedOpaqueObjects = new WeakSet()
  var patchedOpaqueObjectRefs = []
  var patchedOpaqueObjectRefAddCount = 0
  var patchedOpaqueObjectRefLastCompactionCount = 0
  var opaqueObjectContextMap = new WeakMap()
  var weakRefFactory =
    __BUILD_ENV__REPLAY_DEBUG_ENABLED__ &&
    Object.prototype.hasOwnProperty.call(options, 'weakRefFactory')
    ? typeof options.weakRefFactory === 'function'
      ? options.weakRefFactory
      : undefined
    : typeof WeakRef === 'function'
      ? function (value) {
        return new WeakRef(value)
      }
      : undefined
  var scheduledFlushId
  var unpublishedCleanupTimeoutId
  var unpublishedCleanupDeadline
  var stopped = false
  var paused = false
  var objectRefRegistry =
    (__BUILD_ENV__REPLAY_DEBUG_ENABLED__ && options.objectRefRegistry) ||
    createCanvasCommandObjectRefRegistry()
  var onCommandOverflow = __BUILD_ENV__REPLAY_DEBUG_ENABLED__
    ? options.onCommandOverflow || function () {}
    : undefined
  var getCanvasId =
    options.getCanvasId ||
    function (context) {
      return context && context.canvas && context.canvas.__sn && context.canvas.__sn.id
    }
  var getCanvasType =
    options.getCanvasType ||
    function () {
      return '2D'
    }
  var requestSnapshotFallback =
    options.requestSnapshotFallback || function () {}
  var onContextDiscovered =
    options.onContextDiscovered || function () {}
  var onContextMutation =
    options.onContextMutation || function () {}
  var shouldRecordContext =
    options.shouldRecordContext ||
    function () {
      return true
    }

  function scheduleFlush() {
    if (stopped || paused || scheduledFlushId !== undefined) {
      return
    }
    scheduledFlushId = requestAnimationFrameImpl(function () {
      scheduledFlushId = undefined
      flush()
    })
  }

  function getOrCreatePendingBatch(context) {
    var batch = pendingCommandsByContext.get(context)
    if (!batch) {
      if (
        pendingCommandsByContext.size >=
        MAX_PENDING_CANVAS_COMMAND_CONTEXTS
      ) {
        return
      }
      var startedAt = now()
      var canvasId = getCanvasId(context)
      batch = {
        commands: [],
        approxBytesCount: 0,
        startedAt: startedAt,
        fallbackDirty: false,
        fallbackSnapshotRequested: false,
        unpublishedDeadline:
          canvasId === undefined ||
          canvasId === null ||
          canvasId === -1
            ? startedAt +
              MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS
            : undefined
      }
      pendingCommandsByContext.set(context, batch)
      if (batch.unpublishedDeadline !== undefined) {
        refreshUnpublishedCleanupTimer()
      }
    }
    return batch
  }

  function isSnapshotFallbackContext(context) {
    return (
      fallbackModeContexts.has(context) ||
      persistentFallbackModeContexts.has(context)
    )
  }

  function getSnapshotFallbackReason(context) {
    return (
      persistentFallbackReasonByContext.get(context) ||
      fallbackReasonByContext.get(context)
    )
  }

  function deletePendingBatch(context) {
    var batch = pendingCommandsByContext.get(context)
    if (!batch) {
      return
    }
    pendingCommandApproxBytes = Math.max(
      0,
      pendingCommandApproxBytes - batch.approxBytesCount
    )
    pendingCommandsByContext.delete(context)
  }

  function clearUnpublishedCleanupTimer() {
    if (unpublishedCleanupTimeoutId !== undefined) {
      clearTimeoutImpl(unpublishedCleanupTimeoutId)
      unpublishedCleanupTimeoutId = undefined
    }
    unpublishedCleanupDeadline = undefined
  }

  function clearPendingBatches() {
    pendingCommandsByContext.clear()
    pendingCommandApproxBytes = 0
    clearUnpublishedCleanupTimer()
  }

  function expireUnpublishedBatch(context) {
    deletePendingBatch(context)
    persistentFallbackModeContexts.add(context)
    expiredUnpublishedContexts.add(context)
    if (!persistentFallbackReasonByContext.has(context)) {
      persistentFallbackReasonByContext.set(
        context,
        'canvas_publication_timeout'
      )
    }
  }

  function expireOverdueUnpublishedBatches() {
    if (unpublishedCleanupDeadline === undefined) {
      return
    }
    var currentTime = now()
    if (currentTime < unpublishedCleanupDeadline) {
      return
    }
    pendingCommandsByContext.forEach(function (batch, context) {
      if (
        batch.unpublishedDeadline !== undefined &&
        currentTime >= batch.unpublishedDeadline
      ) {
        expireUnpublishedBatch(context)
      }
    })
    refreshUnpublishedCleanupTimer()
  }

  function refreshUnpublishedCleanupTimer() {
    var earliestDeadline
    pendingCommandsByContext.forEach(function (batch) {
      if (
        batch.unpublishedDeadline !== undefined &&
        (earliestDeadline === undefined ||
          batch.unpublishedDeadline < earliestDeadline)
      ) {
        earliestDeadline = batch.unpublishedDeadline
      }
    })

    if (earliestDeadline === undefined) {
      clearUnpublishedCleanupTimer()
      return
    }
    if (
      unpublishedCleanupTimeoutId !== undefined &&
      unpublishedCleanupDeadline === earliestDeadline
    ) {
      return
    }

    clearUnpublishedCleanupTimer()
    unpublishedCleanupDeadline = earliestDeadline
    unpublishedCleanupTimeoutId = setTimeoutImpl(function () {
      unpublishedCleanupTimeoutId = undefined
      unpublishedCleanupDeadline = undefined
      flush()
    }, Math.max(earliestDeadline - now(), 0))
  }

  function reportCommandOverflow(reason, context) {
    if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      onCommandOverflow({
        reason: reason,
        context: context,
        pendingContextCount: pendingCommandsByContext.size,
        pendingApproxBytes: pendingCommandApproxBytes
      })
    }
  }

  function enqueueCommand(context, command, approxBytesCount) {
    if (paused) {
      return false
    }
    if (isSnapshotFallbackContext(context)) {
      markSnapshotFallbackDirty(context)
      return false
    }
    var batch = getOrCreatePendingBatch(context)
    if (!batch) {
      enableSnapshotFallbackForContext(
        context,
        'command_global_context_watermark',
        true
      )
      return false
    }
    if (
      batch.commands.length >= MAX_CANVAS_COMMANDS_PER_BATCH ||
      approxBytesCount >
        MAX_CANVAS_COMMAND_BATCH_BYTES - batch.approxBytesCount
    ) {
      enableSnapshotFallbackForContext(
        context,
        'command_batch_overflow'
      )
      return false
    }
    if (
      approxBytesCount >
      MAX_PENDING_CANVAS_COMMAND_BYTES - pendingCommandApproxBytes
    ) {
      enableSnapshotFallbackForContext(
        context,
        'command_global_bytes_watermark',
        true
      )
      return false
    }
    batch.commands.push(command)
    batch.approxBytesCount += approxBytesCount
    pendingCommandApproxBytes += approxBytesCount
    scheduleFlush()
    return true
  }

  function captureCommand(context, property, args, setter) {
    if (paused) {
      return
    }
    expireOverdueUnpublishedBatches()
    if (isSnapshotFallbackContext(context)) {
      markSnapshotFallbackDirty(context)
      return
    }
    var batch = getOrCreatePendingBatch(context)
    if (!batch) {
      enableSnapshotFallbackForContext(
        context,
        'command_global_context_watermark',
        true
      )
      return
    }
    if (batch.commands.length >= MAX_CANVAS_COMMANDS_PER_BATCH) {
      enableSnapshotFallbackForContext(
        context,
        'command_batch_overflow'
      )
      return
    }

    var estimate
    try {
      estimate = estimateCanvasCommand(
        property,
        args,
        setter,
        MAX_CANVAS_COMMAND_BATCH_BYTES - batch.approxBytesCount
      )
    } catch (_) {
      enableSnapshotFallbackForContext(
        context,
        'command_serialization_error'
      )
      return
    }
    if (estimate.fallbackReason) {
      enableSnapshotFallbackForContext(
        context,
        estimate.fallbackReason
      )
      return
    }
    if (estimate.overflow) {
      enableSnapshotFallbackForContext(
        context,
        'command_batch_overflow'
      )
      return
    }
    if (
      estimate.bytes >
      MAX_PENDING_CANVAS_COMMAND_BYTES - pendingCommandApproxBytes
    ) {
      enableSnapshotFallbackForContext(
        context,
        'command_global_bytes_watermark',
        true
      )
      return
    }

    var serializedArgs
    try {
      serializedArgs = objectRefRegistry.serializeArgs(args, context)
    } catch (_) {
      enableSnapshotFallbackForContext(
        context,
        'command_serialization_error'
      )
      return
    }
    var command = {
      property: property,
      args: serializedArgs
    }
    if (setter === true) {
      command.setter = true
    }
    enqueueCommand(context, command, estimate.bytes)
  }

  function markSnapshotFallbackDirty(context, requestImmediately) {
    if (paused || expiredUnpublishedContexts.has(context)) {
      return
    }
    var batch = pendingCommandsByContext.get(context)
    if (!batch) {
      if (
        pendingCommandsByContext.size >=
        MAX_PENDING_CANVAS_COMMAND_CONTEXTS
      ) {
        requestSnapshotFallback(
          context,
          getSnapshotFallbackReason(context) ||
            'unsupported_canvas_object'
        )
        return
      }
      var startedAt = now()
      var canvasId = getCanvasId(context)
      batch = {
        commands: [],
        approxBytesCount: 0,
        startedAt: startedAt,
        fallbackDirty: true,
        fallbackSnapshotRequested: false,
        unpublishedDeadline:
          canvasId === undefined ||
          canvasId === null ||
          canvasId === -1
            ? startedAt +
              MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS
            : undefined
      }
      pendingCommandsByContext.set(context, batch)
      if (batch.unpublishedDeadline !== undefined) {
        refreshUnpublishedCleanupTimer()
      }
    } else {
      pendingCommandApproxBytes = Math.max(
        0,
        pendingCommandApproxBytes - batch.approxBytesCount
      )
      batch.commands = []
      batch.approxBytesCount = 0
      batch.fallbackDirty = true
    }
    if (requestImmediately && !batch.fallbackSnapshotRequested) {
      batch.fallbackSnapshotRequested = true
      requestSnapshotFallback(
        context,
        getSnapshotFallbackReason(context) || 'unsupported_canvas_object'
      )
    }
    scheduleFlush()
  }

  function flushPendingContext(context, flushedAt) {
    var batch = pendingCommandsByContext.get(context)
    if (!batch) {
      return
    }
    if (isSnapshotFallbackContext(context)) {
      if (batch.fallbackDirty && !batch.fallbackSnapshotRequested) {
        requestSnapshotFallback(
          context,
          getSnapshotFallbackReason(context) || 'unsupported_canvas_object'
        )
      }
      deletePendingBatch(context)
      return
    }
    if (!batch.commands.length) {
      deletePendingBatch(context)
      return
    }
    var id = getCanvasId(context)
    if (id === undefined || id === null || id === -1) {
      // A freshly inserted canvas can be drawn before its delayed DOM add is
      // admitted. Retain it for a bounded publication grace period, then
      // release the strong Map key and require an authoritative bitmap if
      // the canvas is ever published later.
      if (batch.unpublishedDeadline === undefined) {
        batch.unpublishedDeadline =
          flushedAt + MAX_UNPUBLISHED_CANVAS_COMMAND_RETENTION_MS
      }
      if (flushedAt >= batch.unpublishedDeadline) {
        expireUnpublishedBatch(context)
      }
      return
    }
    var completedAt = flushedAt
    var commands = batch.commands
    var recordAccepted = emit(
      createCanvasMutationRecord({
        id: id,
        contextType: getCanvasType(context),
        commands: commands,
        timestamp: completedAt,
        startedAt: batch.startedAt,
        completedAt: completedAt
      }),
      {
        approxBytesCount: batch.approxBytesCount,
        commandCount: commands.length
      }
    )
    if (recordAccepted === false) {
      // The command batch never entered the replay segment. Its following
      // commands can depend on state from this batch, so switch this context
      // to bitmap snapshots and request an immediate visual rebaseline.
      enableSnapshotFallbackForContext(
        context,
        'command_record_rejected'
      )
    }
    deletePendingBatch(context)
  }

  function flushContext(context) {
    if (stopped || paused || !context) {
      return
    }
    flushPendingContext(context, now())
    refreshUnpublishedCleanupTimer()
  }

  function flush() {
    if (stopped || paused) {
      return
    }

    var flushedAt = now()
    pendingCommandsByContext.forEach(function (_, context) {
      flushPendingContext(context, flushedAt)
    })
    refreshUnpublishedCleanupTimer()
  }

  function retryPublishedContext(context) {
    if (
      stopped ||
      paused ||
      !context ||
      !trackedContextSet.has(context)
    ) {
      return false
    }
    expireOverdueUnpublishedBatches()
    var id = getCanvasId(context)
    if (id === undefined || id === null || id === -1) {
      return false
    }
    if (!pendingCommandsByContext.has(context)) {
      if (!expiredUnpublishedContexts.has(context)) {
        return false
      }
      expiredUnpublishedContexts.delete(context)
      // A canvas published after its command grace period no longer has a
      // complete command history. Rebaseline it once instead of retaining the
      // detached context strongly or replaying an incomplete command stream.
      markSnapshotFallbackDirty(context, true)
    }
    // Publication belongs to one exact DOM admission boundary. Flushing every
    // context here could move commands from another, already-published canvas
    // ahead of DOM mutations that happened before its scheduled frame.
    flushContext(context)
    return true
  }

  function shouldCaptureContext(context) {
    if (!trackedContextSet.has(context)) {
      return false
    }
    if (captureGenerationByContext.get(context) !== captureGeneration) {
      captureGenerationByContext.set(context, captureGeneration)
      // reset() accompanies a new replay/full-snapshot canvas baseline, but
      // it cannot reset the live application's transform, clip, path or style
      // state. Existing contexts therefore cannot safely resume command mode.
      enableSnapshotFallbackForContext(
        context,
        'canvas_state_reset',
        false,
        true
      )
    }
    return true
  }

  function registerTrackedContext(context, restoreFns) {
    if (!context || trackedContextSet.has(context)) {
      return false
    }
    restoreFns = restoreFns || []

    if (
      restoreFns.length &&
      trackedContexts.length >=
        MAX_STRONG_CANVAS_CONTEXT_RESTORE_RECORDS
    ) {
      return false
    }

    if (restoreFns.length) {
      trackedContexts.push({
        context: context,
        restore: function () {
          trackedContextSet.delete(context)
          deletePendingBatch(context)
          expiredUnpublishedContexts.delete(context)
          fallbackModeContexts.delete(context)
          persistentFallbackModeContexts.delete(context)
          fallbackReasonByContext.delete(context)
          persistentFallbackReasonByContext.delete(context)
          while (restoreFns.length) {
            restoreFns.pop()()
          }
        }
      })
    }
    trackedContextSet.add(context)
    captureGenerationByContext.set(context, captureGeneration)
    return true
  }

  function maybeTrackContext(context) {
    if (
      stopped ||
      !context ||
      trackedContextSet.has(context) ||
      rejectedContextSet.has(context) ||
      !context.canvas
    ) {
      return false
    }
    if (shouldRecordContext(context) === false) {
      rejectedContextSet.add(context)
      return false
    }
    if (!registerTrackedContext(context, [])) {
      return false
    }
    var hasAuthoritativeBitmapBaseline = false
    try {
      hasAuthoritativeBitmapBaseline =
        onContextDiscovered(context) === true
    } catch (_) {}

    // A context discovered through the already-patched shared prototype was
    // created before this recorder observed getContext(). Its current drawing
    // state (transform, clip/path and styles) cannot be reconstructed safely
    // from later commands, so keep this context on the snapshot path.
    if (hasAuthoritativeBitmapBaseline) {
      markPersistentSnapshotFallback(
        context,
        'existing_bitmap_state'
      )
    } else {
      enableSnapshotFallbackForContext(
        context,
        'existing_canvas_context',
        false,
        true
      )
    }
    return true
  }

  function notifyContextMutation(context) {
    try {
      onContextMutation(context)
    } catch (_) {}
  }

  function rejectContext(context) {
    if (!context) {
      return
    }
    rejectedContextSet.add(context)
    trackedContextSet.delete(context)
    deletePendingBatch(context)
    expiredUnpublishedContexts.delete(context)
    fallbackModeContexts.delete(context)
    persistentFallbackModeContexts.delete(context)
    fallbackReasonByContext.delete(context)
    persistentFallbackReasonByContext.delete(context)
  }

  function enableSnapshotFallbackForContext(
    context,
    reason,
    isGlobalOverflow,
    persistent
  ) {
    var fallbackContexts = persistent
      ? persistentFallbackModeContexts
      : fallbackModeContexts
    var fallbackReasons = persistent
      ? persistentFallbackReasonByContext
      : fallbackReasonByContext
    fallbackContexts.add(context)
    if (!fallbackReasons.has(context)) {
      fallbackReasons.set(
        context,
        reason || 'unsupported_canvas_object'
      )
    }
    if (isGlobalOverflow) {
      reportCommandOverflow(reason, context)
    }
    deletePendingBatch(context)
    markSnapshotFallbackDirty(context, true)
  }

  function patchGradientObjectMethods(value, context) {
    if (
      !value ||
      typeof value !== 'object' ||
      typeof value.addColorStop !== 'function'
    ) {
      return
    }

    opaqueObjectContextMap.set(value, context)

    if (patchedOpaqueObjects.has(value)) {
      return
    }
    if (
      !weakRefFactory &&
      patchedOpaqueObjectRefs.length >=
        MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS
    ) {
      return
    }

    var objectRef
    try {
      objectRef = weakRefFactory
        ? weakRefFactory(value)
        : { value: value }
    } catch (_) {
      return
    }
    if (!addPatchedOpaqueObjectRef(objectRef)) {
      return
    }

    var originalAddColorStop = value.addColorStop
    var wrappedAddColorStop = function () {
      if (
        stopped ||
        this[PATCHED_ADD_COLOR_STOP_KEY] !== wrappedAddColorStop
      ) {
        var restoredOriginal = this[ORIGINAL_ADD_COLOR_STOP_KEY]
        if (typeof restoredOriginal === 'function') {
          if (this.addColorStop === wrappedAddColorStop) {
            this.addColorStop = restoredOriginal
          }
          delete this[ORIGINAL_ADD_COLOR_STOP_KEY]
          delete this[PATCHED_ADD_COLOR_STOP_KEY]
          return restoredOriginal.apply(this, arguments)
        }
      }
      var result = originalAddColorStop.apply(this, arguments)
      var fallbackContext = opaqueObjectContextMap.get(this)
      if (fallbackContext && shouldCaptureContext(fallbackContext)) {
        notifyContextMutation(fallbackContext)
        enableSnapshotFallbackForContext(
          fallbackContext,
          'gradient_color_stop'
        )
      }
      return result
    }
    try {
      value[ORIGINAL_ADD_COLOR_STOP_KEY] = originalAddColorStop
      value[PATCHED_ADD_COLOR_STOP_KEY] = wrappedAddColorStop
      value.addColorStop = wrappedAddColorStop
      patchedOpaqueObjects.add(value)
    } catch (_) {}
  }

  function dereferencePatchedOpaqueObject(objectRef) {
    return objectRef && typeof objectRef.deref === 'function'
      ? objectRef.deref()
      : objectRef && objectRef.value
  }

  function compactPatchedOpaqueObjectRefs() {
    var retainedRefs = []
    for (var index = 0; index < patchedOpaqueObjectRefs.length; index += 1) {
      var objectRef = patchedOpaqueObjectRefs[index]
      if (dereferencePatchedOpaqueObject(objectRef)) {
        retainedRefs.push(objectRef)
      }
    }
    patchedOpaqueObjectRefs = retainedRefs
  }

  function addPatchedOpaqueObjectRef(objectRef) {
    patchedOpaqueObjectRefAddCount += 1
    if (
      weakRefFactory &&
      patchedOpaqueObjectRefs.length >=
        MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS &&
      (patchedOpaqueObjectRefLastCompactionCount === 0 ||
        patchedOpaqueObjectRefAddCount -
          patchedOpaqueObjectRefLastCompactionCount >=
          Math.max(
            Math.floor(
              MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS / 4
            ),
            1
          ))
    ) {
      compactPatchedOpaqueObjectRefs()
      patchedOpaqueObjectRefLastCompactionCount =
        patchedOpaqueObjectRefAddCount
    }
    if (
      patchedOpaqueObjectRefs.length <
      MAX_CANVAS_OPAQUE_OBJECT_RESTORE_RECORDS
    ) {
      patchedOpaqueObjectRefs.push(objectRef)
      return true
    }
    // Never evict a live restore record: doing so would leave an SDK wrapper
    // (and its recorder closure) installed after stop(). A gradient that
    // cannot get a bounded restore record remains native; assigning it to a
    // style still switches the owning context to snapshot fallback.
    return false
  }

  function restorePatchedOpaqueObjects() {
    while (patchedOpaqueObjectRefs.length) {
      var objectRef = patchedOpaqueObjectRefs.pop()
      var object = dereferencePatchedOpaqueObject(objectRef)
      if (
        object &&
        object[PATCHED_ADD_COLOR_STOP_KEY] &&
        typeof object[ORIGINAL_ADD_COLOR_STOP_KEY] === 'function'
      ) {
        if (
          object.addColorStop === object[PATCHED_ADD_COLOR_STOP_KEY]
        ) {
          object.addColorStop = object[ORIGINAL_ADD_COLOR_STOP_KEY]
        }
        delete object[ORIGINAL_ADD_COLOR_STOP_KEY]
        delete object[PATCHED_ADD_COLOR_STOP_KEY]
      }
    }
  }

  function patchMethodOnTarget(
    target,
    methodName,
    restoreFns,
    alwaysSnapshotFallback
  ) {
    if (typeof target[methodName] !== 'function') {
      return false
    }
    var originalMethod = target[methodName]
    var wrappedMethod = function () {
      maybeTrackContext(this)
      var shouldCapture = shouldCaptureContext(this)
      var result = originalMethod.apply(this, arguments)
      if (shouldCapture) {
        notifyContextMutation(this)
      }
      if (shouldCapture && alwaysSnapshotFallback) {
        try {
          if (isSnapshotFallbackContext(this)) {
            markSnapshotFallbackDirty(this)
          } else {
            enableSnapshotFallbackForContext(
              this,
              'unsupported_canvas_method',
              false,
              true
            )
          }
        } catch (_) {}
        return result
      }
      if (shouldCapture && isSnapshotFallbackContext(this)) {
        try {
          markSnapshotFallbackDirty(this)
        } catch (_) {}
        return result
      }
      if (shouldCapture) {
        try {
          var drawImageFallbackReason =
            methodName === 'drawImage'
              ? isUnsupportedDrawImageSource(arguments[0])
              : undefined
          if (drawImageFallbackReason) {
            enableSnapshotFallbackForContext(
              this,
              drawImageFallbackReason
            )
          } else {
            captureCommand(this, methodName, arguments, false)
          }
        } catch (_) {
          try {
            enableSnapshotFallbackForContext(
              this,
              'command_serialization_error'
            )
          } catch (_) {}
        }
      }
      if (
        shouldCapture &&
        (methodName === 'createLinearGradient' ||
          methodName === 'createRadialGradient' ||
          methodName === 'createConicGradient')
      ) {
        patchGradientObjectMethods(result, this)
      }
      return result
    }
    try {
      target[methodName] = wrappedMethod
    } catch (_) {
      return false
    }
    if (target[methodName] !== wrappedMethod) {
      return false
    }
    restoreFns.push(function () {
      if (target[methodName] === wrappedMethod) {
        target[methodName] = originalMethod
      }
    })
    return true
  }

  function patchPropertyOnTarget(
    target,
    propertyName,
    restoreFns,
    alwaysSnapshotFallback
  ) {
    if (!canPatchProperty(target, propertyName)) {
      return false
    }
    var originalDescriptor = getPropertyDescriptor(target, propertyName)
    var fallbackValues = new WeakMap()
    var wrappedGetter = function () {
      if (originalDescriptor && originalDescriptor.get) {
        return originalDescriptor.get.call(this)
      }
      return fallbackValues.get(this)
    }
    var wrappedSetter = function (value) {
      maybeTrackContext(this)
      fallbackValues.set(this, value)
      if (originalDescriptor && originalDescriptor.set) {
        originalDescriptor.set.call(this, value)
      }
      var shouldCapture = shouldCaptureContext(this)
      if (shouldCapture) {
        notifyContextMutation(this)
        if (alwaysSnapshotFallback) {
          try {
            if (isSnapshotFallbackContext(this)) {
              markSnapshotFallbackDirty(this)
            } else {
              enableSnapshotFallbackForContext(
                this,
                'unsupported_canvas_property',
                false,
                true
              )
            }
          } catch (_) {}
          return
        }
        if (isSnapshotFallbackContext(this)) {
          try {
            markSnapshotFallbackDirty(this)
          } catch (_) {}
          return
        }
        try {
          captureCommand(this, propertyName, [value], true)
        } catch (_) {
          try {
            enableSnapshotFallbackForContext(
              this,
              'command_serialization_error'
            )
          } catch (_) {}
        }
      }
    }
    try {
      Object.defineProperty(target, propertyName, {
        configurable: true,
        enumerable: true,
        get: wrappedGetter,
        set: wrappedSetter
      })
    } catch (_) {
      return false
    }
    restoreFns.push(function () {
      var currentDescriptor = Object.getOwnPropertyDescriptor(
        target,
        propertyName
      )
      if (
        !currentDescriptor ||
        currentDescriptor.get !== wrappedGetter ||
        currentDescriptor.set !== wrappedSetter
      ) {
        return
      }
      if (originalDescriptor) {
        Object.defineProperty(target, propertyName, originalDescriptor)
      } else {
        delete target[propertyName]
      }
    })
    return true
  }

  function patchUnknownMutationsOnTarget(target, restoreFns) {
    var propertyNames
    try {
      propertyNames = Object.getOwnPropertyNames(target)
    } catch (_) {
      snapshotFallbackPatchTargets.add(target)
      return
    }
    propertyNames.forEach(function (propertyName) {
      if (
        propertyName === 'constructor' ||
        CANVAS_2D_CAPTURED_METHOD_NAMES[propertyName] ||
        CANVAS_2D_CAPTURED_PROPERTY_NAMES[propertyName] ||
        CANVAS_2D_NON_MUTATING_METHODS[propertyName]
      ) {
        return
      }
      var descriptor
      try {
        descriptor = Object.getOwnPropertyDescriptor(
          target,
          propertyName
        )
      } catch (_) {
        snapshotFallbackPatchTargets.add(target)
        return
      }
      if (descriptor && typeof descriptor.value === 'function') {
        if (
          !patchMethodOnTarget(
            target,
            propertyName,
            restoreFns,
            true
          )
        ) {
          snapshotFallbackPatchTargets.add(target)
        }
        return
      }
      if (
        descriptor &&
        typeof descriptor.set === 'function' &&
        !patchPropertyOnTarget(
          target,
          propertyName,
          restoreFns,
          true
        )
      ) {
        snapshotFallbackPatchTargets.add(target)
      }
    })
  }

  function patchPrototype(context) {
    var prototype = Object.getPrototypeOf(context)
    if (!prototype || prototype === Object.prototype) {
      return false
    }
    var existingRecord = patchedPrototypeRecords.find(function (record) {
      return record.prototype === prototype
    })
    if (existingRecord) {
      return true
    }
    if (
      patchedPrototypeRecords.length >=
      MAX_PATCHED_CANVAS_PROTOTYPE_RECORDS
    ) {
      return false
    }

    var restoreFns = []
    CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
      if (
        typeof prototype[methodName] === 'function' &&
        !patchMethodOnTarget(prototype, methodName, restoreFns)
      ) {
        snapshotFallbackPatchTargets.add(prototype)
      }
    })
    CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
      if (
        getPropertyDescriptor(prototype, propertyName) &&
        !patchPropertyOnTarget(prototype, propertyName, restoreFns)
      ) {
        snapshotFallbackPatchTargets.add(prototype)
      }
    })
    patchUnknownMutationsOnTarget(prototype, restoreFns)

    patchedPrototypeRecords.push({
      prototype: prototype,
      restore: function () {
        while (restoreFns.length) {
          restoreFns.pop()()
        }
      }
    })
    return true
  }

  function patchSharedPrototype(prototype) {
    if (!prototype || prototype === Object.prototype) {
      return false
    }
    var existingRecord = patchedPrototypeRecords.find(function (record) {
      return record.prototype === prototype
    })
    if (existingRecord) {
      return true
    }
    if (
      patchedPrototypeRecords.length >=
      MAX_PATCHED_CANVAS_PROTOTYPE_RECORDS
    ) {
      return false
    }

    var restoreFns = []
    CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
      if (
        typeof prototype[methodName] === 'function' &&
        !patchMethodOnTarget(prototype, methodName, restoreFns)
      ) {
        snapshotFallbackPatchTargets.add(prototype)
      }
    })
    CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
      if (
        getPropertyDescriptor(prototype, propertyName) &&
        !patchPropertyOnTarget(prototype, propertyName, restoreFns)
      ) {
        snapshotFallbackPatchTargets.add(prototype)
      }
    })
    patchUnknownMutationsOnTarget(prototype, restoreFns)

    patchedPrototypeRecords.push({
      prototype: prototype,
      restore: function () {
        while (restoreFns.length) {
          restoreFns.pop()()
        }
      }
    })
    return true
  }

  function patchContextInstance(context, restoreFns) {
    CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
      if (
        typeof context[methodName] === 'function' &&
        !patchMethodOnTarget(context, methodName, restoreFns)
      ) {
        snapshotFallbackPatchTargets.add(context)
      }
    })

    CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
      if (!patchPropertyOnTarget(context, propertyName, restoreFns)) {
        snapshotFallbackPatchTargets.add(context)
      }
    })
    patchUnknownMutationsOnTarget(context, restoreFns)
  }

  function patchContext(context) {
    if (stopped || !context || trackedContextSet.has(context)) {
      return function () {}
    }

    var restoreFns = []
    var prototype = Object.getPrototypeOf(context)
    if (prototype && prototype !== Object.prototype) {
      if (!patchPrototype(context)) {
        return function () {}
      }
    } else {
      patchContextInstance(context, restoreFns)
    }

    if (!registerTrackedContext(context, restoreFns)) {
      while (restoreFns.length) {
        restoreFns.pop()()
      }
      return function () {}
    }
    if (
      snapshotFallbackPatchTargets.has(context) ||
      (prototype && snapshotFallbackPatchTargets.has(prototype))
    ) {
      enableSnapshotFallbackForContext(
        context,
        'unpatchable_canvas_api',
        false,
        true
      )
    }

    return function () {
      trackedContextSet.delete(context)
      deletePendingBatch(context)
      expiredUnpublishedContexts.delete(context)
      fallbackModeContexts.delete(context)
      persistentFallbackModeContexts.delete(context)
      fallbackReasonByContext.delete(context)
      persistentFallbackReasonByContext.delete(context)
      var trackedIndex = trackedContexts.findIndex(function (tracked) {
        return tracked.context === context
      })
      if (trackedIndex >= 0) {
        trackedContexts.splice(trackedIndex, 1)[0].restore()
      }
    }
  }

  function stop() {
    stopped = true
    if (scheduledFlushId !== undefined) {
      cancelAnimationFrameImpl(scheduledFlushId)
      scheduledFlushId = undefined
    }
    clearPendingBatches()
    fallbackModeContexts = new WeakSet()
    persistentFallbackModeContexts = new WeakSet()
    fallbackReasonByContext = new WeakMap()
    persistentFallbackReasonByContext = new WeakMap()
    expiredUnpublishedContexts = new WeakSet()
    rejectedContextSet = new WeakSet()
    opaqueObjectContextMap = new WeakMap()
    restorePatchedOpaqueObjects()
    while (trackedContexts.length) {
      trackedContexts.pop().restore()
    }
    while (patchedPrototypeRecords.length) {
      patchedPrototypeRecords.pop().restore()
    }
    trackedContextSet = new WeakSet()
    captureGenerationByContext = new WeakMap()
    objectRefRegistry.reset()
  }

  function pause() {
    paused = true
    if (scheduledFlushId !== undefined) {
      cancelAnimationFrameImpl(scheduledFlushId)
      scheduledFlushId = undefined
    }
    clearPendingBatches()
    fallbackModeContexts = new WeakSet()
    fallbackReasonByContext = new WeakMap()
    rejectedContextSet = new WeakSet()
    objectRefRegistry.reset()
  }

  function resume() {
    paused = false
  }

  function reset() {
    captureGeneration += 1
    if (scheduledFlushId !== undefined) {
      cancelAnimationFrameImpl(scheduledFlushId)
      scheduledFlushId = undefined
    }
    clearPendingBatches()
    fallbackModeContexts = new WeakSet()
    fallbackReasonByContext = new WeakMap()
    rejectedContextSet = new WeakSet()
    objectRefRegistry.reset()
  }

  function forceSnapshotFallback(context, reason) {
    if (stopped || !trackedContextSet.has(context)) {
      return
    }
    // An explicit authoritative rebaseline supersedes the implicit
    // canvas_state_reset transition for this generation.
    captureGenerationByContext.set(context, captureGeneration)
    expiredUnpublishedContexts.delete(context)
    enableSnapshotFallbackForContext(
      context,
      reason || 'forced_snapshot_rebaseline',
      false,
      true
    )
  }

  function markPersistentSnapshotFallback(context, reason) {
    if (stopped || !trackedContextSet.has(context)) {
      return
    }
    expiredUnpublishedContexts.delete(context)
    persistentFallbackModeContexts.add(context)
    if (!persistentFallbackReasonByContext.has(context)) {
      persistentFallbackReasonByContext.set(
        context,
        reason || 'persistent_snapshot_fallback'
      )
    }
    // The authoritative bitmap was already admitted by the caller. Only
    // retire command state here; requesting another snapshot would duplicate
    // the initial encode and increase startup work for every canvas.
    deletePendingBatch(context)
  }

  return {
    patchContext: patchContext,
    patchSharedPrototype: patchSharedPrototype,
    rejectContext: rejectContext,
    forceSnapshotFallback: forceSnapshotFallback,
    markPersistentSnapshotFallback: markPersistentSnapshotFallback,
    flush: flush,
    flushContext: flushContext,
    retryPublishedContext: retryPublishedContext,
    pause: pause,
    resume: resume,
    reset: reset,
    stop: stop
  }
}
