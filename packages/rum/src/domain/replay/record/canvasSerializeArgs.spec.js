import {
  buildSerializedCanvasImage,
  estimateEncodedBytesFromDataUrl
} from './canvasSerializeArgs'

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

  it('should estimate encoded bytes from a data url', () => {
    expect(
      estimateEncodedBytesFromDataUrl('data:image/webp;base64,QUJDRA==')
    ).toBe(6)
  })
})
