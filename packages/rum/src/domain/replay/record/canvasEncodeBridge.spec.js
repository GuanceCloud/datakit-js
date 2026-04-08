import { createCanvasEncodeBridge } from './canvasEncodeBridge'

describe('replay/record/canvasEncodeBridge', () => {
  let canvas

  beforeEach(() => {
    canvas = document.createElement('canvas')
    canvas.width = 20
    canvas.height = 10
  })

  it('should fallback to main-thread encoding when worker encoding is unavailable', async () => {
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: undefined,
        Worker: undefined,
        url: undefined
      }
    )

    const result = await bridge.encode(canvas)

    expect(result.width).toBe(20)
    expect(result.height).toBe(10)
    expect(result.dataUrl.startsWith('data:image/webp;base64,')).toBeTrue()
  })

  it('should use worker encoding when supported', async () => {
    let messageHandler
    const worker = {
      addEventListener: jasmine.createSpy('addEventListener').and.callFake(
        function (type, handler) {
          if (type === 'message') {
            messageHandler = handler
          }
        }
      ),
      postMessage: jasmine.createSpy('postMessage'),
      terminate: jasmine.createSpy('terminate')
    }
    const bitmap = { close: jasmine.createSpy('close') }
    const bridge = createCanvasEncodeBridge(
      {
        replayCanvasMimeType: 'image/webp',
        replayCanvasQuality: 0.4,
        replayCanvasMaxCanvasSize: 1280,
        replayCanvasMaxConcurrentEncodes: 1
      },
      {
        createImageBitmap: jasmine.createSpy('createImageBitmap').and.returnValue(
          Promise.resolve(bitmap)
        ),
        Worker: function FakeWorker() {},
        url: {
          createObjectURL: jasmine.createSpy('createObjectURL').and.returnValue(
            'blob:test'
          ),
          revokeObjectURL: jasmine.createSpy('revokeObjectURL')
        },
        createWorker: jasmine.createSpy('createWorker').and.returnValue(worker)
      }
    )

    const resultPromise = bridge.encode(canvas)
    await Promise.resolve()

    expect(worker.postMessage).toHaveBeenCalled()
    var request = worker.postMessage.calls.mostRecent().args[0]
    messageHandler({
      data: {
        id: request.id,
        action: 'encoded',
        dataUrl: 'data:image/webp;base64,QUJD',
        width: 20,
        height: 10
      }
    })

    expect(await resultPromise).toEqual({
      dataUrl: 'data:image/webp;base64,QUJD',
      width: 20,
      height: 10
    })

    bridge.stop()
    expect(worker.terminate).toHaveBeenCalled()
  })
})
