import { createDeflateEncoder, DeflateEncoderStreamId } from './deflateEncoder'

describe('deflateEncoder', () => {
  function createWorker() {
    return {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
  }

  function emitMessage(worker, data) {
    worker.listeners.message({ data })
  }

  it('should collect worker writes and finish asynchronously', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.RUM)
    const writeCallback = jasmine.createSpy('writeCallback')
    const finishCallback = jasmine.createSpy('finishCallback')

    encoder.write('first', writeCallback)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'write',
      id: 0,
      data: 'first',
      streamId: DeflateEncoderStreamId.RUM
    })

    emitMessage(worker, {
      type: 'wrote',
      id: 0,
      streamId: DeflateEncoderStreamId.RUM,
      additionalBytesCount: 5,
      result: new Uint8Array([1, 2]),
      trailer: new Uint8Array([3])
    })

    expect(writeCallback).toHaveBeenCalledWith(2)

    encoder.finish(finishCallback)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'reset',
      streamId: DeflateEncoderStreamId.RUM
    })
    expect(finishCallback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        rawBytesCount: 5,
        outputBytesCount: 3,
        encoding: 'deflate'
      })
    )
  })

  it('should return pending data when finished synchronously before worker responses', () => {
    const worker = createWorker()
    const encoder = createDeflateEncoder(worker, DeflateEncoderStreamId.REPLAY)

    encoder.write('first')
    encoder.write('second')

    const result = encoder.finishSync()

    expect(result.pendingData).toEqual(['first', 'second'])
    expect(result.outputBytesCount).toBe(0)
    expect(worker.postMessage).toHaveBeenCalledWith({
      action: 'reset',
      streamId: DeflateEncoderStreamId.REPLAY
    })
  })
})
