import {
  LifeCycle,
  LifeCycleEventType,
  Observable,
  RumEventType
} from '@cloudcare/browser-core'
import { createDeflateEncoder } from '../domain/deflate/deflateEncoder'
import { EncoderStreamId } from '../domain/encoderStreamId'
import { startRumBatch } from './startRumBatch'

describe('startRumBatch', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = window.fetch
    window.fetch = jasmine.createSpy('fetch').and.returnValue(
      Promise.resolve({
        status: 200,
        type: 'basic'
      })
    )
  })

  afterEach(() => {
    window.fetch = originalFetch
  })

  it('should route view events through upsert and other events through add', () => {
    const lifeCycle = new LifeCycle()
    const telemetryEventObservable = new Observable()
    const pageExitObservable = new Observable()
    const sessionExpireObservable = new Observable()
    const encoder = {
      empty: true,
      isAsync: false,
      isEmpty() {
        return this.empty
      },
      estimateEncodedBytesCount(text) {
        return text.length
      },
      write: jasmine.createSpy('write').and.callFake((text, callback) => {
        encoder.empty = false
        if (callback) {
          callback(text.length)
        }
      }),
      finish: jasmine.createSpy('finish').and.callFake((callback) => {
        callback({
          output: 'encoded-rum-payload',
          outputBytesCount: 19
        })
      })
    }
    const createEncoder = jasmine
      .createSpy('createEncoder')
      .and.returnValue(encoder)

    const batch = startRumBatch(
      {
        rumEndpoint: 'https://example.com/v1/write/rum',
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 20,
        flushTimeout: 30000,
        messageBytesLimit: 256,
        sendContentTypeByJson: false
      },
      lifeCycle,
      telemetryEventObservable,
      jasmine.createSpy('reportError'),
      pageExitObservable,
      sessionExpireObservable,
      createEncoder
    )

    expect(createEncoder).toHaveBeenCalledWith(EncoderStreamId.RUM)
    expect(batch.flushObservable).toEqual(jasmine.any(Object))

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.VIEW,
      date: 1,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      display: {
        viewport: { width: 100, height: 200 }
      },
      view: { id: 'view-1', loading_type: 'initial_load' }
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      date: 2,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      error: { message: 'boom' }
    })
    telemetryEventObservable.notify({
      type: 'telemetry',
      date: 3,
      telemetry: { status: 'debug' }
    })
    sessionExpireObservable.notify()

    expect(encoder.write.calls.count()).toBe(3)
    expect(encoder.write.calls.argsFor(0)[0]).toContain('error')
    expect(encoder.write.calls.argsFor(1)[0]).toContain('telemetry')
    expect(encoder.write.calls.argsFor(2)[0]).toContain('view')
    expect(encoder.finish).toHaveBeenCalled()
    expect(window.fetch).toHaveBeenCalled()
  })

  it('should upload the failed compressed batch and the next batch through the identity fallback', async () => {
    const lifeCycle = new LifeCycle()
    const telemetryEventObservable = new Observable()
    const pageExitObservable = new Observable()
    const sessionExpireObservable = new Observable()
    const encoderError = new Error('compression worker failed')
    const worker = {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
    const failedEncoder = createDeflateEncoder(
      worker,
      EncoderStreamId.RUM
    )
    spyOn(failedEncoder, 'stop').and.callThrough()

    startRumBatch(
      {
        rumEndpoint: 'https://example.com/v1/write/rum',
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 20,
        flushTimeout: 30000,
        messageBytesLimit: 256,
        sendContentTypeByJson: false
      },
      lifeCycle,
      telemetryEventObservable,
      jasmine.createSpy('reportError'),
      pageExitObservable,
      sessionExpireObservable,
      jasmine.createSpy('createEncoder').and.returnValue(failedEncoder)
    )

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      date: 1,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      error: { message: 'compressed-before-failure' }
    })
    worker.listeners.message({
      data: {
        type: 'wrote',
        id: 0,
        streamId: EncoderStreamId.RUM,
        additionalBytesCount: 10,
        result: new Uint8Array([1, 2]),
        trailer: new Uint8Array([3])
      }
    })
    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      date: 2,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      error: { message: 'pending-at-failure' }
    })
    sessionExpireObservable.notify()
    worker.listeners.error(encoderError)
    await Promise.resolve()

    expect(window.fetch).toHaveBeenCalledTimes(1)
    expect(window.fetch.calls.argsFor(0)[1].body).toContain(
      'compressed-before-failure'
    )
    expect(window.fetch.calls.argsFor(0)[1].body).toContain(
      'pending-at-failure'
    )
    expect(window.fetch.calls.argsFor(0)[1].body.length).toBeGreaterThan(0)
    expect(failedEncoder.stop).toHaveBeenCalledTimes(1)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      date: 3,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      error: { message: 'identity-fallback-batch' }
    })
    sessionExpireObservable.notify()
    await Promise.resolve()

    expect(window.fetch).toHaveBeenCalledTimes(2)
    expect(window.fetch.calls.argsFor(1)[1].body).toContain(
      'identity-fallback-batch'
    )
    expect(window.fetch.calls.argsFor(1)[1].body.length).toBeGreaterThan(0)
  })

  it('should preserve messages when a recoverable stream error is followed by more writes', async () => {
    const lifeCycle = new LifeCycle()
    const telemetryEventObservable = new Observable()
    const pageExitObservable = new Observable()
    const sessionExpireObservable = new Observable()
    const streamError = new Error('stream compression failed')
    const worker = {
      listeners: {},
      postMessage: jasmine.createSpy('postMessage'),
      addEventListener(type, listener) {
        this.listeners[type] = listener
      },
      removeEventListener: jasmine.createSpy('removeEventListener')
    }
    const failedEncoder = createDeflateEncoder(
      worker,
      EncoderStreamId.RUM
    )
    spyOn(failedEncoder, 'stop').and.callThrough()

    startRumBatch(
      {
        rumEndpoint: 'https://example.com/v1/write/rum',
        batchBytesLimit: 1024,
        retryMaxSize: 3,
        batchMessagesLimit: 20,
        flushTimeout: 30000,
        messageBytesLimit: 256,
        sendContentTypeByJson: false
      },
      lifeCycle,
      telemetryEventObservable,
      jasmine.createSpy('reportError'),
      pageExitObservable,
      sessionExpireObservable,
      jasmine.createSpy('createEncoder').and.returnValue(failedEncoder)
    )

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      date: 1,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      error: { message: 'before-stream-error' }
    })
    worker.listeners.message({
      data: {
        type: 'errored',
        error: streamError,
        streamId: EncoderStreamId.RUM
      }
    })

    expect(failedEncoder.stop).toHaveBeenCalledTimes(1)

    lifeCycle.notify(LifeCycleEventType.RUM_EVENT_COLLECTED, {
      type: RumEventType.ERROR,
      date: 2,
      application: { id: 'app-1' },
      session: { id: 'session-1', type: 'user', is_sampling: true },
      service: 'web',
      source: 'browser',
      error: { message: 'after-stream-error' }
    })
    sessionExpireObservable.notify()
    await Promise.resolve()

    expect(window.fetch).toHaveBeenCalledTimes(1)
    expect(window.fetch.calls.argsFor(0)[1].body).toContain(
      'before-stream-error'
    )
    expect(window.fetch.calls.argsFor(0)[1].body).toContain(
      'after-stream-error'
    )
  })
})
