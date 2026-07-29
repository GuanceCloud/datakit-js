import { markReplayInternalCanvas } from './canvasContext'

var AUTO_CANVAS_SIGNATURE_SIZE = 8
var AUTO_CANVAS_SIGNATURE_DIFF_THRESHOLD = 8

export function createCanvasFrameSignatureExtractor() {
  var signatureContext
  resetSignatureContext()

  return function (canvas) {
    if (!signatureContext) {
      return undefined
    }
    try {
      signatureContext.clearRect(
        0,
        0,
        AUTO_CANVAS_SIGNATURE_SIZE,
        AUTO_CANVAS_SIGNATURE_SIZE
      )
      signatureContext.drawImage(
        canvas,
        0,
        0,
        AUTO_CANVAS_SIGNATURE_SIZE,
        AUTO_CANVAS_SIGNATURE_SIZE
      )

      return buildCanvasFrameSignature(
        signatureContext.getImageData(
          0,
          0,
          AUTO_CANVAS_SIGNATURE_SIZE,
          AUTO_CANVAS_SIGNATURE_SIZE
        ).data
      )
    } catch (_) {
      // Drawing a cross-origin canvas taints the destination permanently;
      // clearRect() cannot make that internal surface origin-clean again.
      // Replace both canvas and context so later safe frames can resume
      // signature-based deduplication.
      resetSignatureContext()
      return undefined
    }
  }

  function resetSignatureContext() {
    signatureContext = undefined
    try {
      var signatureCanvas = markReplayInternalCanvas(
        document.createElement('canvas')
      )
      signatureCanvas.width = AUTO_CANVAS_SIGNATURE_SIZE
      signatureCanvas.height = AUTO_CANVAS_SIGNATURE_SIZE
      signatureContext = signatureCanvas.getContext('2d', {
        willReadFrequently: true
      })
    } catch (_) {}
  }
}

export function buildCanvasFrameSignature(imageData) {
  var signature = []

  for (var index = 0; index < imageData.length; index += 4) {
    signature.push(
      Math.round(
        imageData[index] * 0.299 +
          imageData[index + 1] * 0.587 +
          imageData[index + 2] * 0.114
      )
    )
  }

  return signature
}

export function isCanvasFrameBelowThreshold(previousSignature, nextSignature) {
  if (
    !Array.isArray(previousSignature) ||
    !Array.isArray(nextSignature) ||
    previousSignature.length !== nextSignature.length
  ) {
    return false
  }

  var totalDifference = 0

  for (var index = 0; index < previousSignature.length; index += 1) {
    totalDifference += Math.abs(previousSignature[index] - nextSignature[index])
  }

  return (
    totalDifference / previousSignature.length <=
    AUTO_CANVAS_SIGNATURE_DIFF_THRESHOLD
  )
}
