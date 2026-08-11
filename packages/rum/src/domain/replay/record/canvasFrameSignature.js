import { markReplayInternalCanvas } from './canvasContext'

// A 24x24 downsample keeps the probe bounded (2.25 KiB readback) while retaining
// enough spatial detail for small sprites and thin chart strokes on the
// 480x240 canvases commonly used by dashboards.  The previous 8x8 thumbnail
// could average a 6x6 moving sprite completely below the perceptual threshold.
var AUTO_CANVAS_SIGNATURE_SIZE = 24
// Each pixel contributes luma and alpha, so 4 keeps the previous effective
// luma tolerance of 8 when alpha is unchanged.
var AUTO_CANVAS_SIGNATURE_DIFF_THRESHOLD = 4
// The average protects against full-frame encoder noise, while this peak
// threshold keeps a small moving sprite or thin chart line from disappearing
// inside the other samples.
var AUTO_CANVAS_SIGNATURE_PEAK_DIFF_THRESHOLD = 16

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
  // Keep one byte each for luma and alpha.  At 24x24 this is 1.125 KiB per
  // retained canvas instead of a several-times-larger generic JS number array.
  var signature = new Uint8Array(imageData.length / 2)
  var signatureIndex = 0

  for (var index = 0; index < imageData.length; index += 4) {
    // Alpha must remain an independent sample: clearRect() can change an
    // opaque black pixel to transparent black without changing its RGB bytes.
    signature[signatureIndex] = Math.round(
      imageData[index] * 0.299 +
        imageData[index + 1] * 0.587 +
        imageData[index + 2] * 0.114
    )
    signature[signatureIndex + 1] = imageData[index + 3]
    signatureIndex += 2
  }

  return signature
}

export function isCanvasFrameBelowThreshold(previousSignature, nextSignature) {
  if (
    !previousSignature ||
    !nextSignature ||
    previousSignature.length !== nextSignature.length
  ) {
    return false
  }

  var totalDifference = 0
  for (var index = 0; index < previousSignature.length; index += 1) {
    var difference = Math.abs(
      previousSignature[index] - nextSignature[index]
    )
    if (difference > AUTO_CANVAS_SIGNATURE_PEAK_DIFF_THRESHOLD) {
      return false
    }
    totalDifference += difference
  }

  return (
    totalDifference / previousSignature.length <=
    AUTO_CANVAS_SIGNATURE_DIFF_THRESHOLD
  )
}
