import {
  buildSerializedCanvasImage,
  estimateEncodedBytesFromDataUrl,
  getEncodedCanvasDataUrlDiagnostics,
  isValidEncodedCanvasDataUrl
} from './canvasSerializeArgs'

function decodeBase64(base64) {
  var binary = atob(base64)
  var bytes = new Uint8Array(binary.length)
  for (var i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer
}

describe('replay/record/canvasSerializeArgs', () => {
  it('should build an rrweb-compatible image bitmap payload from a data url', () => {
    expect(
      buildSerializedCanvasImage('data:image/webp;base64,QUJD', 'image/webp')
    ).toEqual({
      rr_type: 'ImageBitmap',
      args: [
        {
          rr_type: 'Blob',
          data: [{ rr_type: 'ArrayBuffer', base64: 'QUJD' }],
          type: 'image/webp'
        }
      ]
    })
  })

  it('should prefer the actual mime type from the data url over the configured mime type', () => {
    expect(
      buildSerializedCanvasImage('data:image/png;base64,QUJD', 'image/webp')
    ).toEqual({
      rr_type: 'ImageBitmap',
      args: [
        {
          rr_type: 'Blob',
          data: [{ rr_type: 'ArrayBuffer', base64: 'QUJD' }],
          type: 'image/png'
        }
      ]
    })
  })

  it('should estimate encoded bytes from a data url', () => {
    expect(
      estimateEncodedBytesFromDataUrl('data:image/webp;base64,QUJDRA==')
    ).toBe(6)
  })

  it('should reject malformed base64 payloads with an inline padding marker', () => {
    expect(
      isValidEncodedCanvasDataUrl('data:image/webp;base64,QUJD=REVG')
    ).toBeFalse()
  })

  it('should expose encoded canvas payload diagnostics for malformed data urls', () => {
    expect(
      getEncodedCanvasDataUrlDiagnostics('data:image/webp;base64,QUJD=REVG')
    ).toEqual({
      mimeType: 'image/webp',
      dataUrlLength: 32,
      base64Length: 9,
      base64Prefix: 'QUJD=REVG',
      base64Suffix: 'QUJD=REVG',
      firstPaddingIndex: 4,
      firstPaddingWindow: 'QUJD=REVG',
      invalidCharacterIndex: undefined,
      invalidCharacterWindow: undefined,
      hasMidstreamPadding: true
    })
  })

  it('should produce an ImageBitmap payload that can be decoded by createImageBitmap', async () => {
    var canvas = document.createElement('canvas')
    canvas.width = 12
    canvas.height = 8
    var context = canvas.getContext('2d')
    context.fillStyle = '#0ea5e9'
    context.fillRect(0, 0, canvas.width, canvas.height)

    var dataUrl = canvas.toDataURL('image/webp')
    var serializedImage = buildSerializedCanvasImage(dataUrl, 'image/webp')
    var blobArg = serializedImage.args[0]
    var blob = new Blob([decodeBase64(blobArg.data[0].base64)], {
      type: blobArg.type
    })

    var bitmap = await createImageBitmap(blob)

    expect(bitmap.width).toBeGreaterThan(0)
    expect(bitmap.height).toBeGreaterThan(0)

    if (typeof bitmap.close === 'function') {
      bitmap.close()
    }
  })
})
