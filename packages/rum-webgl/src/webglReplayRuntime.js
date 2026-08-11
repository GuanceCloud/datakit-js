import { createWebGLReplayEncoder } from './webglReplayEncoder'
import {
  getCanvasWebGLSnapshotContextType,
  installCanvasWebGLSnapshotBootstrap,
  normalizeCanvasWebGLSnapshotContextType,
  startCanvasWebGLSnapshotObserver
} from './canvasWebGLSnapshotObserver'

function noop() {}

function reportFailure(report, phase, error) {
  try {
    report(phase, error)
  } catch (_) {}
}

function callComponent(component, method, phase, report) {
  try {
    if (component && typeof component[method] === 'function') {
      return component[method]()
    }
  } catch (error) {
    reportFailure(report, phase, error)
  }
}

function hasMethods(component, methods) {
  for (var index = 0; index < methods.length; index += 1) {
    if (!component || typeof component[methods[index]] !== 'function') {
      return false
    }
  }
  return true
}

function createNoopObserver(isWebGLCanvas) {
  return {
    isWebGLCanvas: isWebGLCanvas,
    reset: noop,
    stop: noop
  }
}

function createSafeObserver(observer, isWebGLCanvas, report) {
  var stopped = false

  function call(method, argument) {
    if (
      stopped ||
      !observer ||
      typeof observer[method] !== 'function'
    ) {
      return
    }
    try {
      return observer[method](argument)
    } catch (error) {
      stopped = true
      reportFailure(report, method, error)
      callComponent(observer, 'stop', method, report)
    }
  }

  return {
    isWebGLCanvas: function (canvas) {
      var result = call('isWebGLCanvas', canvas)
      return stopped ? isWebGLCanvas(canvas) : result
    },
    reset: function () {
      call('reset')
    },
    stop: function () {
      if (stopped) {
        return
      }
      stopped = true
      callComponent(observer, 'stop', 'stop_observer', report)
    }
  }
}

export function createWebGLReplayRuntime(
  configuration,
  baseEncodeBridge,
  hostMarkInternalCanvas,
  report
) {
  report = typeof report === 'function' ? report : noop
  var contextTypeByCanvas = new WeakMap()
  var internalCanvases = new WeakSet()

  function getCanvasContextType(canvas) {
    return (
      contextTypeByCanvas.get(canvas) ||
      getCanvasWebGLSnapshotContextType(canvas)
    )
  }

  function setCanvasContextType(canvas, contextType) {
    contextType = normalizeCanvasWebGLSnapshotContextType(contextType)
    if (canvas && contextType) {
      contextTypeByCanvas.set(canvas, contextType)
    }
  }

  function isWebGLCanvas(canvas) {
    var contextType = getCanvasContextType(canvas)
    return contextType === 'webgl' || contextType === 'webgl2'
  }

  function markInternalCanvas(canvas) {
    if (canvas) {
      internalCanvases.add(canvas)
    }
    return typeof hostMarkInternalCanvas === 'function'
      ? hostMarkInternalCanvas(canvas)
      : canvas
  }

  function encodeCanvas(canvas, encodeOptions) {
    if (typeof baseEncodeBridge.encodeWithLifecycle === 'function') {
      return baseEncodeBridge.encodeWithLifecycle(canvas, encodeOptions)
    }
    var result
    try {
      result = Promise.resolve(
        baseEncodeBridge.encode(canvas, encodeOptions)
      )
    } catch (error) {
      result = Promise.reject(error)
    }
    return {
      result: result,
      physicalSettled: result.then(noop, noop)
    }
  }

  var encoder
  try {
    encoder = createWebGLReplayEncoder({
      configuration: configuration,
      hostEncodeCanvas: encodeCanvas,
      hostGetCanvasContextType: getCanvasContextType,
      hostMarkInternalCanvas: markInternalCanvas
    })
    if (!hasMethods(encoder, ['encode', 'reset', 'stop'])) {
      callComponent(encoder, 'stop', 'cleanup_invalid_encoder', report)
      reportFailure(report, 'invalid_encoder', new Error('Invalid encoder'))
      return []
    }
    if (
      configuration.replayCanvasEnabled === true &&
      configuration.replayCanvasMode === 'auto'
    ) {
      // The runtime factory runs before Canvas 2D command capture is started.
      // Reinstall the WebGL bootstrap here on every replay start so its
      // wrapper remains below the command-capture wrapper. plugin.onInit()
      // only runs once, while Session Replay can stop and restart repeatedly.
      installCanvasWebGLSnapshotBootstrap({
        // Renew the short lease while command capture is being initialized.
        // The observer claims it synchronously; initialization failures still
        // restore the wrappers instead of leaving them installed forever.
        bootstrapLeaseDuration: 30000
      })
    }
  } catch (error) {
    callComponent(encoder, 'stop', 'cleanup_failed_encoder', report)
    reportFailure(report, 'create_encoder', error)
    return []
  }

  var stopped = false
  var encodeBridge = {
    encode: function (canvas, encodeOptions) {
      if (stopped) {
        return Promise.reject(new Error('Canvas encode router stopped'))
      }
      if (!isWebGLCanvas(canvas)) {
        return baseEncodeBridge.encode(canvas, encodeOptions)
      }
      try {
        return Promise.resolve(encoder.encode(canvas, encodeOptions))
      } catch (error) {
        return Promise.reject(error)
      }
    },
    reset: function () {
      baseEncodeBridge.reset()
      callComponent(encoder, 'reset', 'reset_encoder', report)
    },
    stop: function () {
      if (stopped) {
        return
      }
      stopped = true
      callComponent(encoder, 'stop', 'stop_encoder', report)
      baseEncodeBridge.stop()
    }
  }

  function startObserver(snapshotCanvas, getSerializedNodeId, onDebug) {
    var observer
    try {
      observer = startCanvasWebGLSnapshotObserver({
        configuration: configuration,
        hostSnapshotCanvas: snapshotCanvas,
        hostGetSerializedNodeId: getSerializedNodeId,
        hostOnDebug: onDebug,
        hostGetCanvasContextType: getCanvasContextType,
        hostSetCanvasContextType: setCanvasContextType,
        hostNormalizeCanvasContextType:
          normalizeCanvasWebGLSnapshotContextType,
        hostIsInternalCanvas: function (canvas) {
          return internalCanvases.has(canvas)
        },
        hostShouldRecordCanvas: function (canvas) {
          try {
            return configuration.shouldRecordCanvas
              ? configuration.shouldRecordCanvas(canvas)
              : true
          } catch (_) {
            return false
          }
        }
      })
      if (!hasMethods(observer, ['isWebGLCanvas', 'reset', 'stop'])) {
        callComponent(
          observer,
          'stop',
          'cleanup_invalid_observer',
          report
        )
        return createNoopObserver(isWebGLCanvas)
      }
    } catch (error) {
      callComponent(
        observer,
        'stop',
        'cleanup_failed_observer',
        report
      )
      reportFailure(report, 'start_observer', error)
      return createNoopObserver(isWebGLCanvas)
    }
    return createSafeObserver(observer, isWebGLCanvas, report)
  }

  // This tuple is the only value that crosses from the independently
  // minified addon into the RUM host. Positional members keep the private ABI
  // independent from property mangling in either bundle.
  return [encodeBridge, startObserver]
}
