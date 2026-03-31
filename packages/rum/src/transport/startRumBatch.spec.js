import {
  LifeCycle,
  LifeCycleEventType,
  Observable,
  RumEventType
} from '@cloudcare/browser-core'
import { DeflateEncoderStreamId } from '../domain/deflate'
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

    expect(createEncoder).toHaveBeenCalledWith(DeflateEncoderStreamId.RUM)
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
})
