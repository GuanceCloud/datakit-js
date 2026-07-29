import {
  getReplayCanvasContextType,
  isReplayInternalCanvas,
  isWebGLReplayCanvas,
  markReplayInternalCanvas,
  normalizeReplayCanvasContextType,
  ReplayCanvasContextType,
  setReplayCanvasContextType
} from './canvasContext'

describe('replay/record/canvasContext', () => {
  it('should normalize supported canvas context names', () => {
    expect(normalizeReplayCanvasContextType('2D')).toBe(
      ReplayCanvasContextType.Canvas2D
    )
    expect(normalizeReplayCanvasContextType('experimental-webgl')).toBe(
      ReplayCanvasContextType.WebGL
    )
    expect(normalizeReplayCanvasContextType('webgl2')).toBe(
      ReplayCanvasContextType.WebGL2
    )
    expect(normalizeReplayCanvasContextType('bitmaprenderer')).toBeUndefined()
  })

  it('should remember whether a canvas uses WebGL', () => {
    var canvas = document.createElement('canvas')

    setReplayCanvasContextType(canvas, 'webgl')

    expect(getReplayCanvasContextType(canvas)).toBe('webgl')
    expect(isWebGLReplayCanvas(canvas)).toBeTrue()
  })

  it('should mark SDK-owned canvases so capture hooks can ignore them', () => {
    var canvas = document.createElement('canvas')

    expect(markReplayInternalCanvas(canvas)).toBe(canvas)
    expect(isReplayInternalCanvas(canvas)).toBeTrue()
  })
})
