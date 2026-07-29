import { createCanvasFrameSignatureExtractor } from './canvasFrameSignature'

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

    expect(extractFrameSignature(safeSource)).toEqual([18])
    expect(safeContext.drawImage).toHaveBeenCalledOnceWith(
      safeSource,
      0,
      0,
      8,
      8
    )
    expect(safeContext.getImageData).toHaveBeenCalledTimes(1)
    expect(createElementSpy).toHaveBeenCalledTimes(2)
  })
})
