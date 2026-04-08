import { LifeCycle, LifeCycleEventType, Observable } from '@cloudcare/browser-core'
import { startLogsBatch } from './startLogsBatch'

describe('logs/startLogsBatch', () => {
  it('should expose a batch and forward collected logs to batch.add', () => {
    const lifeCycle = new LifeCycle()
    const batch = startLogsBatch(
      {
        logsEndpoint: 'https://logs.example.com/v1/input',
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 50,
        flushTimeout: 30000,
        messageBytesLimit: 256
      },
      lifeCycle,
      jasmine.createSpy('reportError'),
      new Observable(),
      {
        expireObservable: new Observable()
      }
    )
    const addSpy = jasmine.createSpy('add')
    const originalAdd = batch.add

    batch.add = addSpy
    lifeCycle.notify(LifeCycleEventType.LOG_COLLECTED, {
      message: 'hello',
      status: 'info'
    })

    expect(batch.flushObservable).toEqual(jasmine.any(Object))
    expect(addSpy).toHaveBeenCalledWith({
      message: 'hello',
      status: 'info'
    })

    batch.add = originalAdd
    batch.stop()
  })

  it('should forward each collected log event independently', () => {
    const lifeCycle = new LifeCycle()
    const batch = startLogsBatch(
      {
        logsEndpoint: 'https://logs.example.com/v1/input',
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 50,
        flushTimeout: 30000,
        messageBytesLimit: 256
      },
      lifeCycle,
      jasmine.createSpy('reportError'),
      new Observable(),
      {
        expireObservable: new Observable()
      }
    )
    const addSpy = jasmine.createSpy('add')
    const originalAdd = batch.add

    batch.add = addSpy
    lifeCycle.notify(LifeCycleEventType.LOG_COLLECTED, {
      message: 'first',
      status: 'info'
    })
    lifeCycle.notify(LifeCycleEventType.LOG_COLLECTED, {
      message: 'second',
      status: 'error'
    })

    expect(addSpy.calls.count()).toBe(2)
    expect(addSpy.calls.argsFor(0)[0]).toEqual({
      message: 'first',
      status: 'info'
    })
    expect(addSpy.calls.argsFor(1)[0]).toEqual({
      message: 'second',
      status: 'error'
    })

    batch.add = originalAdd
    batch.stop()
  })
})
