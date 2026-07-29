import { Observable } from '../helper/observable'
import { startBatchWithReplica } from './startBatchWithReplica'

describe('startBatchWithReplica', () => {
  it('should create a batch with transport and flush configuration, then proxy calls to it', () => {
    const flushObservable = new Observable()
    const add = jasmine.createSpy('add')
    const upsert = jasmine.createSpy('upsert')
    const stop = jasmine.createSpy('stop')
    const encoderFallback = jasmine.createSpy('encoderFallback')
    const batchFactory = jasmine.createSpy('batchFactory').and.returnValue({
      flushController: { flushObservable },
      add,
      upsert,
      stop
    })

    const batch = startBatchWithReplica(
      {
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 50,
        flushTimeout: 30000,
        messageBytesLimit: 256,
        sendContentTypeByJson: true
      },
      {
        endpoint: 'https://example.com/rum',
        encoder: { isAsync: false },
        encoderFallback
      },
      jasmine.createSpy('reportError'),
      new Observable(),
      new Observable(),
      batchFactory
    )

    expect(batchFactory).toHaveBeenCalledWith(
      jasmine.objectContaining({
        encoder: { isAsync: false },
        encoderFallback,
        request: jasmine.objectContaining({
          send: jasmine.any(Function),
          sendOnExit: jasmine.any(Function)
        }),
        flushController: jasmine.objectContaining({
          flushObservable: jasmine.any(Object)
        }),
        messageBytesLimit: 256,
        sendContentTypeByJson: true
      })
    )
    expect(batch.flushObservable).toBe(flushObservable)

    batch.add('message')
    batch.upsert('message', 'key')
    batch.stop()

    expect(add).toHaveBeenCalledWith('message')
    expect(upsert).toHaveBeenCalledWith('message', 'key')
    expect(stop).toHaveBeenCalled()
  })
})
