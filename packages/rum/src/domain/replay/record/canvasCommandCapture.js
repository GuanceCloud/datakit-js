import { serializeCanvasCommandArgs } from './canvasCommandSerializeArgs'
import { createCanvasMutationRecord } from './canvasMutationRecord'

var CANVAS_2D_CAPTURED_METHODS = [
  'save',
  'restore',
  'translate',
  'scale',
  'rotate',
  'transform',
  'setTransform',
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
  'drawImage'
]

var CANVAS_2D_CAPTURED_PROPERTIES = [
  'fillStyle',
  'strokeStyle',
  'lineWidth',
  'lineCap',
  'lineJoin',
  'miterLimit',
  'font',
  'globalAlpha',
  'shadowColor',
  'shadowBlur',
  'shadowOffsetX',
  'shadowOffsetY',
  'textAlign',
  'textBaseline',
  'filter'
]

var UNSUPPORTED_REPLAY_OBJECT_NAMES = {
  CanvasGradient: true,
  CanvasPattern: true,
  Path2D: true
}
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

function getFallbackReasonForValue(value) {
  if (Array.isArray(value)) {
    for (var index = 0; index < value.length; index += 1) {
      var nestedReason = getFallbackReasonForValue(value[index])
      if (nestedReason) {
        return nestedReason
      }
    }
    return
  }
  var constructorName = getCanvasObjectConstructorName(value)
  if (!constructorName || !UNSUPPORTED_REPLAY_OBJECT_NAMES[constructorName]) {
    return
  }
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
  if (typeof HTMLCanvasElement !== 'undefined' && value instanceof HTMLCanvasElement) {
    return 'draw_image_canvas'
  }
  if (typeof HTMLVideoElement !== 'undefined' && value instanceof HTMLVideoElement) {
    return 'draw_image_video'
  }
  if (isCrossOriginImageElement(value)) {
    return 'draw_image_cross_origin'
  }
}

export function createCanvas2DCommandRecorder(options) {
  options = options || {}
  var emit = options.emit || function () {}
  var now = options.now || Date.now
  var requestAnimationFrameImpl =
    options.requestAnimationFrameImpl ||
    function (callback) {
      return window.requestAnimationFrame(callback)
    }
  var cancelAnimationFrameImpl =
    options.cancelAnimationFrameImpl ||
    function (rafId) {
      return window.cancelAnimationFrame(rafId)
    }

  var trackedContexts = []
  var trackedContextSet = new Set()
  var patchedPrototypeRecords = []
  var pendingCommandsByContext = new Map()
  var fallbackModeContexts = new WeakSet()
  var fallbackReasonByContext = new WeakMap()
  var patchedOpaqueObjects = new WeakSet()
  var patchedOpaqueObjectRefs = []
  var opaqueObjectContextMap = new WeakMap()
  var weakRefFactory = Object.prototype.hasOwnProperty.call(
    options,
    'weakRefFactory'
  )
    ? typeof options.weakRefFactory === 'function'
      ? options.weakRefFactory
      : undefined
    : typeof WeakRef === 'function'
      ? function (value) {
        return new WeakRef(value)
      }
      : undefined
  var scheduledFlushId
  var stopped = false
  var paused = false
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

  function enqueueCommand(context, command) {
    if (paused) {
      return
    }
    if (!pendingCommandsByContext.has(context)) {
      pendingCommandsByContext.set(context, {
        commands: [],
        startedAt: now()
      })
    }
    pendingCommandsByContext.get(context).commands.push(command)
    scheduleFlush()
  }

  function flush() {
    if (stopped || paused) {
      return
    }

    pendingCommandsByContext.forEach(function (batch, context) {
      if (!batch.commands.length) {
        return
      }
      if (fallbackModeContexts.has(context)) {
        requestSnapshotFallback(
          context,
          fallbackReasonByContext.get(context) || 'unsupported_canvas_object'
        )
        return
      }
      var id = getCanvasId(context)
      if (id === undefined || id === null || id === -1) {
        return
      }
      var completedAt = now()
      emit(
        createCanvasMutationRecord({
          id: id,
          contextType: getCanvasType(context),
          commands: batch.commands.slice(),
          timestamp: completedAt,
          startedAt: batch.startedAt,
          completedAt: completedAt
        })
      )
    })
    pendingCommandsByContext.clear()
  }

  function shouldCaptureContext(context) {
    return trackedContextSet.has(context)
  }

  function registerTrackedContext(context, restoreFns) {
    if (!context || trackedContextSet.has(context)) {
      return false
    }
    restoreFns = restoreFns || []

    Object.defineProperty(context, '__dd_command_capture__', {
      configurable: true,
      enumerable: false,
      value: true
    })
    restoreFns.push(function () {
      delete context.__dd_command_capture__
    })

    trackedContexts.push({
      context: context,
      restore: function () {
        trackedContextSet.delete(context)
        pendingCommandsByContext.delete(context)
        fallbackReasonByContext.delete(context)
        while (restoreFns.length) {
          restoreFns.pop()()
        }
      }
    })
    trackedContextSet.add(context)
    return true
  }

  function maybeTrackContext(context) {
    if (
      !context ||
      trackedContextSet.has(context) ||
      !context.canvas ||
      shouldRecordContext(context) === false
    ) {
      return false
    }
    return registerTrackedContext(context, [])
  }

  function enableSnapshotFallbackForContext(context, reason) {
    fallbackModeContexts.add(context)
    if (!fallbackReasonByContext.has(context)) {
      fallbackReasonByContext.set(
        context,
        reason || 'unsupported_canvas_object'
      )
    }
    pendingCommandsByContext.delete(context)
    requestSnapshotFallback(
      context,
      fallbackReasonByContext.get(context) || 'unsupported_canvas_object'
    )
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

    var originalAddColorStop = value.addColorStop
    try {
      value[ORIGINAL_ADD_COLOR_STOP_KEY] = originalAddColorStop
      value[PATCHED_ADD_COLOR_STOP_KEY] = true
      value.addColorStop = function () {
        if (stopped || !this[PATCHED_ADD_COLOR_STOP_KEY]) {
          var restoredOriginal = this[ORIGINAL_ADD_COLOR_STOP_KEY]
          if (typeof restoredOriginal === 'function') {
            this.addColorStop = restoredOriginal
            delete this[ORIGINAL_ADD_COLOR_STOP_KEY]
            delete this[PATCHED_ADD_COLOR_STOP_KEY]
            return restoredOriginal.apply(this, arguments)
          }
        }
        var fallbackContext = opaqueObjectContextMap.get(this)
        if (fallbackContext && shouldCaptureContext(fallbackContext)) {
          enableSnapshotFallbackForContext(fallbackContext, 'gradient_color_stop')
        }
        return originalAddColorStop.apply(this, arguments)
      }
      patchedOpaqueObjects.add(value)
      patchedOpaqueObjectRefs.push(
        weakRefFactory ? weakRefFactory(value) : { value: value }
      )
    } catch (_) {}
  }

  function restorePatchedOpaqueObjects() {
    while (patchedOpaqueObjectRefs.length) {
      var objectRef = patchedOpaqueObjectRefs.pop()
      var object = objectRef && typeof objectRef.deref === 'function'
        ? objectRef.deref()
        : objectRef && objectRef.value
      if (
        object &&
        object[PATCHED_ADD_COLOR_STOP_KEY] &&
        typeof object[ORIGINAL_ADD_COLOR_STOP_KEY] === 'function'
      ) {
        object.addColorStop = object[ORIGINAL_ADD_COLOR_STOP_KEY]
        delete object[ORIGINAL_ADD_COLOR_STOP_KEY]
        delete object[PATCHED_ADD_COLOR_STOP_KEY]
      }
    }
  }

  function patchMethodOnTarget(target, methodName, restoreFns) {
    if (typeof target[methodName] !== 'function') {
      return
    }
    var originalMethod = target[methodName]
    target[methodName] = function () {
      maybeTrackContext(this)
      var drawImageFallbackReason =
        shouldCaptureContext(this) && methodName === 'drawImage'
          ? isUnsupportedDrawImageSource(arguments[0])
          : undefined
      if (drawImageFallbackReason) {
        enableSnapshotFallbackForContext(this, drawImageFallbackReason)
        return originalMethod.apply(this, arguments)
      }
      var fallbackReason = shouldCaptureContext(this)
        ? getFallbackReasonForValue(Array.prototype.slice.call(arguments))
        : undefined
      if (fallbackReason) {
        enableSnapshotFallbackForContext(this, fallbackReason)
        return originalMethod.apply(this, arguments)
      }
      var serializedArgs
      if (shouldCaptureContext(this)) {
        try {
          serializedArgs = serializeCanvasCommandArgs(arguments, this)
        } catch (error) {
          throw error
        }
        enqueueCommand(this, {
          property: methodName,
          args: serializedArgs
        })
      }
      var result = originalMethod.apply(this, arguments)
      if (
        shouldCaptureContext(this) &&
        (methodName === 'createLinearGradient' ||
          methodName === 'createRadialGradient' ||
          methodName === 'createConicGradient')
      ) {
        patchGradientObjectMethods(result, this)
      }
      return result
    }
    restoreFns.push(function () {
      target[methodName] = originalMethod
    })
  }

  function patchPropertyOnTarget(target, propertyName, restoreFns) {
    if (!canPatchProperty(target, propertyName)) {
      return
    }
    var originalDescriptor = getPropertyDescriptor(target, propertyName)
    var fallbackValues = new WeakMap()
    Object.defineProperty(target, propertyName, {
      configurable: true,
      enumerable: true,
      get: function () {
        if (originalDescriptor && originalDescriptor.get) {
          return originalDescriptor.get.call(this)
        }
        return fallbackValues.get(this)
      },
      set: function (value) {
        maybeTrackContext(this)
        fallbackValues.set(this, value)
        if (originalDescriptor && originalDescriptor.set) {
          originalDescriptor.set.call(this, value)
        }
        if (shouldCaptureContext(this)) {
          var fallbackReason = getFallbackReasonForValue(value)
          if (fallbackReason) {
            enableSnapshotFallbackForContext(this, fallbackReason)
            return
          }
          enqueueCommand(this, {
            property: propertyName,
            args: [serializeCanvasCommandArgs([value], this)[0]],
            setter: true
          })
        }
      }
    })
    restoreFns.push(function () {
      if (originalDescriptor) {
        Object.defineProperty(target, propertyName, originalDescriptor)
      } else {
        delete target[propertyName]
      }
    })
  }

  function patchPrototype(context) {
    var prototype = Object.getPrototypeOf(context)
    if (!prototype || prototype === Object.prototype) {
      return
    }
    var existingRecord = patchedPrototypeRecords.find(function (record) {
      return record.prototype === prototype
    })
    if (existingRecord) {
      return
    }

    var restoreFns = []
    CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
      patchMethodOnTarget(prototype, methodName, restoreFns)
    })
    CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
      patchPropertyOnTarget(prototype, propertyName, restoreFns)
    })

    patchedPrototypeRecords.push({
      prototype: prototype,
      restore: function () {
        while (restoreFns.length) {
          restoreFns.pop()()
        }
      }
    })
  }

  function patchSharedPrototype(prototype) {
    if (!prototype || prototype === Object.prototype) {
      return
    }
    var existingRecord = patchedPrototypeRecords.find(function (record) {
      return record.prototype === prototype
    })
    if (existingRecord) {
      return
    }

    var restoreFns = []
    CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
      patchMethodOnTarget(prototype, methodName, restoreFns)
    })
    CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
      patchPropertyOnTarget(prototype, propertyName, restoreFns)
    })

    patchedPrototypeRecords.push({
      prototype: prototype,
      restore: function () {
        while (restoreFns.length) {
          restoreFns.pop()()
        }
      }
    })
  }

  function patchContextInstance(context, restoreFns) {
    CANVAS_2D_CAPTURED_METHODS.forEach(function (methodName) {
      patchMethodOnTarget(context, methodName, restoreFns)
    })

    CANVAS_2D_CAPTURED_PROPERTIES.forEach(function (propertyName) {
      patchPropertyOnTarget(context, propertyName, restoreFns)
    })
  }

  function patchContext(context) {
    if (!context || context.__dd_command_capture__) {
      return function () {}
    }

    var restoreFns = []
    var prototype = Object.getPrototypeOf(context)
    if (prototype && prototype !== Object.prototype) {
      patchPrototype(context)
    } else {
      patchContextInstance(context, restoreFns)
    }

    registerTrackedContext(context, restoreFns)

    return function () {
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
    pendingCommandsByContext.clear()
    fallbackModeContexts = new WeakSet()
    fallbackReasonByContext = new WeakMap()
    opaqueObjectContextMap = new WeakMap()
    restorePatchedOpaqueObjects()
    while (trackedContexts.length) {
      trackedContexts.pop().restore()
    }
    while (patchedPrototypeRecords.length) {
      patchedPrototypeRecords.pop().restore()
    }
  }

  function pause() {
    paused = true
    if (scheduledFlushId !== undefined) {
      cancelAnimationFrameImpl(scheduledFlushId)
      scheduledFlushId = undefined
    }
    pendingCommandsByContext.clear()
    fallbackModeContexts = new WeakSet()
    fallbackReasonByContext = new WeakMap()
  }

  function resume() {
    paused = false
  }

  function reset() {
    if (scheduledFlushId !== undefined) {
      cancelAnimationFrameImpl(scheduledFlushId)
      scheduledFlushId = undefined
    }
    pendingCommandsByContext.clear()
    fallbackModeContexts = new WeakSet()
    fallbackReasonByContext = new WeakMap()
  }

  return {
    patchContext: patchContext,
    patchSharedPrototype: patchSharedPrototype,
    flush: flush,
    pause: pause,
    resume: resume,
    reset: reset,
    stop: stop
  }
}
