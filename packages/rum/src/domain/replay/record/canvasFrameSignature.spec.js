import {
  buildCanvasFrameSignature,
  createCanvasFrameSignatureExtractor,
  isCanvasFrameBelowThreshold
} from './canvasFrameSignature'

describe('replay/record/canvasFrameSignature', () => {
  it('should recreate its internal surface after a tainted frame and recover on the next safe canvas', () => {
    const taintedContext = {
      clearRect: jasmine.createSpy('taintedClearRect'),
      drawImage: jasmine.createSpy('taintedDrawImage'),
      getImageData: jasmine
        .createSpy('taintedGetImageData')
        .and.throwError('The canvas has been tainted')
    }
    const safeContext = {
      clearRect: jasmine.createSpy('safeClearRect'),
      drawImage: jasmine.createSpy('safeDrawImage'),
      getImageData: jasmine
        .createSpy('safeGetImageData')
        .and.returnValue({
          data: new Uint8ClampedArray([10, 20, 30, 255])
        })
    }
    const signatureCanvases = [
      {
        getContext: jasmine
          .createSpy('taintedCanvasGetContext')
          .and.returnValue(taintedContext)
      },
      {
        getContext: jasmine
          .createSpy('safeCanvasGetContext')
          .and.returnValue(safeContext)
      }
    ]
    const originalCreateElement = document.createElement.bind(document)
    const createElementSpy = spyOn(document, 'createElement').and.callFake(
      (tagName) =>
        tagName === 'canvas'
          ? signatureCanvases.shift()
          : originalCreateElement(tagName)
    )
    const extractFrameSignature =
      createCanvasFrameSignatureExtractor()
    const taintedSource = {}
    const safeSource = {}

    expect(extractFrameSignature(taintedSource)).toBeUndefined()
    expect(taintedContext.getImageData).toHaveBeenCalledTimes(1)
    expect(createElementSpy).toHaveBeenCalledTimes(2)

    expect(extractFrameSignature(safeSource)).toEqual(
      new Uint8Array([18, 255])
    )
    expect(safeContext.drawImage).toHaveBeenCalledOnceWith(
      safeSource,
      0,
      0,
      24,
      24
    )
    expect(safeContext.getImageData).toHaveBeenCalledTimes(1)
    expect(createElementSpy).toHaveBeenCalledTimes(2)
  })

  it('should detect a transparent clear even when RGB stays black', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 8
    canvas.height = 8
    const context = canvas.getContext('2d')
    const extractFrameSignature = createCanvasFrameSignatureExtractor()

    context.fillStyle = '#000'
    context.fillRect(0, 0, canvas.width, canvas.height)
    const opaqueBlackSignature = extractFrameSignature(canvas)

    context.clearRect(0, 0, canvas.width, canvas.height)
    const transparentBlackSignature = extractFrameSignature(canvas)

    expect(opaqueBlackSignature.length).toBe(1152)
    expect(transparentBlackSignature.length).toBe(1152)
    expect(
      isCanvasFrameBelowThreshold(
        opaqueBlackSignature,
        transparentBlackSignature
      )
    ).toBeFalse()
  })

  it('should keep small RGB noise below the existing threshold', () => {
    const previousFrame = new Uint8ClampedArray(8 * 8 * 4)
    const nextFrame = new Uint8ClampedArray(8 * 8 * 4)
    for (let index = 0; index < previousFrame.length; index += 4) {
      previousFrame[index] = 100
      previousFrame[index + 1] = 100
      previousFrame[index + 2] = 100
      previousFrame[index + 3] = 255
      nextFrame[index] = 105
      nextFrame[index + 1] = 105
      nextFrame[index + 2] = 105
      nextFrame[index + 3] = 255
    }

    expect(
      isCanvasFrameBelowThreshold(
        buildCanvasFrameSignature(previousFrame),
        buildCanvasFrameSignature(nextFrame)
      )
    ).toBeTrue()
  })

  it('should detect a localized RGB or alpha change without amplifying full-frame noise', () => {
    const previousFrame = new Uint8ClampedArray(8 * 8 * 4)
    const localizedRgbFrame = new Uint8ClampedArray(previousFrame)
    const localizedAlphaFrame = new Uint8ClampedArray(previousFrame)
    const globalNoiseFrame = new Uint8ClampedArray(previousFrame)

    for (let index = 0; index < previousFrame.length; index += 4) {
      previousFrame[index + 3] = 255
      localizedRgbFrame[index + 3] = 255
      localizedAlphaFrame[index + 3] = 255
      globalNoiseFrame[index] = 5
      globalNoiseFrame[index + 1] = 5
      globalNoiseFrame[index + 2] = 5
      globalNoiseFrame[index + 3] = 255
    }
    localizedRgbFrame[0] = 255
    localizedRgbFrame[1] = 255
    localizedRgbFrame[2] = 255
    localizedAlphaFrame[3] = 0

    const previousSignature = buildCanvasFrameSignature(previousFrame)
    expect(
      isCanvasFrameBelowThreshold(
        previousSignature,
        buildCanvasFrameSignature(localizedRgbFrame)
      )
    ).toBeFalse()
    expect(
      isCanvasFrameBelowThreshold(
        previousSignature,
        buildCanvasFrameSignature(localizedAlphaFrame)
      )
    ).toBeFalse()
    expect(
      isCanvasFrameBelowThreshold(
        previousSignature,
        buildCanvasFrameSignature(globalNoiseFrame)
      )
    ).toBeTrue()
  })

  it('should detect a small moving sprite on a dashboard-sized canvas', () => {
    const canvas = document.createElement('canvas')
    canvas.width = 480
    canvas.height = 240
    const context = canvas.getContext('2d')
    const extractFrameSignature = createCanvasFrameSignatureExtractor()

    context.fillStyle = '#fff'
    context.fillRect(0, 0, canvas.width, canvas.height)
    context.fillStyle = '#0f172a'
    context.fillRect(116, 90, 6, 6)
    const firstSignature = extractFrameSignature(canvas)

    context.fillStyle = '#fff'
    context.fillRect(116, 90, 6, 6)
    context.fillStyle = '#0f172a'
    context.fillRect(124, 90, 6, 6)
    const movedSignature = extractFrameSignature(canvas)

    expect(
      isCanvasFrameBelowThreshold(firstSignature, movedSignature)
    ).toBeFalse()
  })
})
