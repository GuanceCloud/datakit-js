import {
  serializeCanvasCommandArg,
  serializeCanvasCommandArgs
} from './canvasCommandSerializeArgs'

describe('replay/record/canvasCommandSerializeArgs', () => {
  it('should serialize typed arrays', () => {
    expect(serializeCanvasCommandArg(new Uint8Array([1, 2, 3]))).toEqual({
      rr_type: 'Uint8Array',
      args: [[1, 2, 3]]
    })
  })

  it('should serialize array buffers', () => {
    var buffer = new Uint8Array([65, 66, 67]).buffer

    expect(serializeCanvasCommandArg(buffer)).toEqual({
      rr_type: 'ArrayBuffer',
      base64: 'QUJD'
    })
  })

  it('should serialize image data', () => {
    var imageData = new ImageData(new Uint8ClampedArray([255, 0, 0, 255]), 1, 1)

    expect(serializeCanvasCommandArg(imageData)).toEqual({
      rr_type: 'ImageData',
      args: [
        {
          rr_type: 'Uint8ClampedArray',
          args: [[255, 0, 0, 255]]
        },
        1,
        1
      ]
    })
  })

  it('should serialize html image elements', () => {
    var image = document.createElement('img')
    image.src = 'https://example.com/chart.png'

    expect(serializeCanvasCommandArg(image)).toEqual({
      rr_type: 'HTMLImageElement',
      src: 'https://example.com/chart.png'
    })
  })

  it('should serialize mixed drawImage-style arguments', () => {
    var image = document.createElement('img')
    image.src = 'https://example.com/chart.png'

    expect(serializeCanvasCommandArgs([image, 0, 1, 200, 100])).toEqual([
      {
        rr_type: 'HTMLImageElement',
        src: 'https://example.com/chart.png'
      },
      0,
      1,
      200,
      100
    ])
  })

  it('should serialize data views', () => {
    var buffer = new Uint8Array([65, 66, 67, 68]).buffer
    var dataView = new DataView(buffer, 1, 2)

    expect(serializeCanvasCommandArg(dataView)).toEqual({
      rr_type: 'DataView',
      args: [
        {
          rr_type: 'ArrayBuffer',
          base64: 'QUJDRA=='
        },
        1,
        2
      ]
    })
  })

  it('should serialize opaque canvas objects as stable references per context', () => {
    function FakeCanvasGradient() {}
    var context = {}
    var firstGradient = new FakeCanvasGradient()
    var secondGradient = new FakeCanvasGradient()

    expect(serializeCanvasCommandArg(firstGradient, context)).toEqual({
      rr_type: 'FakeCanvasGradient',
      index: 0
    })
    expect(serializeCanvasCommandArg(firstGradient, context)).toEqual({
      rr_type: 'FakeCanvasGradient',
      index: 0
    })
    expect(serializeCanvasCommandArg(secondGradient, context)).toEqual({
      rr_type: 'FakeCanvasGradient',
      index: 1
    })
  })

  it('should keep object references scoped per context', () => {
    function FakePath2D() {}
    var path = new FakePath2D()

    expect(serializeCanvasCommandArg(path, { id: 1 })).toEqual({
      rr_type: 'FakePath2D',
      index: 0
    })
    expect(serializeCanvasCommandArg(path, { id: 2 })).toEqual({
      rr_type: 'FakePath2D',
      index: 0
    })
  })
})
