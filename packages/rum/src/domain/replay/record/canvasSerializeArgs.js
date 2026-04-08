function dataUrlToBase64(dataUrl) {
  var parts = dataUrl.split(',')
  return parts.length > 1 ? parts[1] : ''
}

export function buildSerializedCanvasImage(dataUrl, mimeType) {
  return {
    rr_type: 'ImageBitmap',
    args: [
      {
        rr_type: 'Blob',
        data: [
          {
            rr_type: 'ArrayBuffer',
            base64: dataUrlToBase64(dataUrl)
          }
        ],
        type: mimeType
      }
    ]
  }
}

export function estimateEncodedBytesFromDataUrl(dataUrl) {
  var base64 = dataUrlToBase64(dataUrl)
  return Math.ceil((base64.length * 3) / 4)
}
