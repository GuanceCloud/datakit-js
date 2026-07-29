var contextTypeByCanvas = new WeakMap()
var replayInternalCanvases = new WeakSet()

export var ReplayCanvasContextType = {
  Canvas2D: '2d',
  WebGL: 'webgl',
  WebGL2: 'webgl2'
}

export function normalizeReplayCanvasContextType(contextType) {
  if (typeof contextType !== 'string') {
    return
  }

  var normalizedContextType = contextType.toLowerCase()
  if (normalizedContextType === 'experimental-webgl') {
    return ReplayCanvasContextType.WebGL
  }
  if (
    normalizedContextType === ReplayCanvasContextType.Canvas2D ||
    normalizedContextType === ReplayCanvasContextType.WebGL ||
    normalizedContextType === ReplayCanvasContextType.WebGL2
  ) {
    return normalizedContextType
  }
}

export function setReplayCanvasContextType(canvas, contextType) {
  var normalizedContextType = normalizeReplayCanvasContextType(contextType)
  if (!canvas || !normalizedContextType) {
    return
  }
  contextTypeByCanvas.set(canvas, normalizedContextType)
}

export function getReplayCanvasContextType(canvas) {
  return canvas ? contextTypeByCanvas.get(canvas) : undefined
}

export function markReplayInternalCanvas(canvas) {
  if (canvas) {
    replayInternalCanvases.add(canvas)
  }
  return canvas
}

export function isReplayInternalCanvas(canvas) {
  return !!canvas && replayInternalCanvases.has(canvas)
}

export function isWebGLReplayCanvas(canvas) {
  var contextType = getReplayCanvasContextType(canvas)
  return (
    contextType === ReplayCanvasContextType.WebGL ||
    contextType === ReplayCanvasContextType.WebGL2
  )
}

export function getReplayCanvasRecordingDecision(configuration, canvas) {
  try {
    return configuration.shouldRecordCanvas
      ? configuration.shouldRecordCanvas(canvas)
      : true
  } catch (_) {
    return false
  }
}
