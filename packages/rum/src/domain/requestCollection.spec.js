import { LifeCycle, LifeCycleEventType } from '@cloudcare/browser-core'
import { resetFetchObservable } from '../../../core/src/browser/fetchObservable'
import { trackFetch, trackXhr } from './requestCollection'

describe('requestCollection', () => {
  let originalFetch
  let OriginalXMLHttpRequest
  let configuration

  class FakeXMLHttpRequest extends EventTarget {
    static DONE = 4

    constructor() {
      super()
      this.readyState = 0
      this.status = 0
      this.onreadystatechange = null
    }

    open(method, url) {
      this.method = method
      this.url = url
    }

    send() {}

    setRequestHeader() {}

    abort() {}
  }

  beforeEach(() => {
    originalFetch = window.fetch
    OriginalXMLHttpRequest = window.XMLHttpRequest
    window.XMLHttpRequest = FakeXMLHttpRequest
    configuration = {
      isIntakeUrl: () => false
    }
  })

  afterEach(() => {
    window.fetch = originalFetch
    window.XMLHttpRequest = OriginalXMLHttpRequest
    resetFetchObservable()
  })

  it('should notify xhr start and completion with tracing metadata', () => {
    const lifeCycle = new LifeCycle()
    const tracer = {
      traceXhr: jasmine.createSpy('traceXhr'),
      clearTracingIfNeeded: jasmine.createSpy('clearTracingIfNeeded')
    }
    const started = jasmine.createSpy('started')
    const completed = jasmine.createSpy('completed')
    const tracking = trackXhr(lifeCycle, configuration, tracer)

    lifeCycle.subscribe(LifeCycleEventType.REQUEST_STARTED, started)
    lifeCycle.subscribe(LifeCycleEventType.REQUEST_COMPLETED, completed)

    const xhr = new XMLHttpRequest()
    xhr.open('post', '/api/orders')
    xhr.setRequestHeader('x-test', 'value')
    xhr.send()

    const startEvent = started.calls.mostRecent().args[0]
    expect(startEvent).toEqual(
      jasmine.objectContaining({
        requestIndex: jasmine.any(Number),
        url: jasmine.stringMatching(/\/api\/orders$/)
      })
    )
    expect(tracer.traceXhr).toHaveBeenCalled()

    xhr.status = 202
    xhr.readyState = XMLHttpRequest.DONE
    xhr.dispatchEvent(new Event('loadend'))

    expect(tracer.clearTracingIfNeeded).toHaveBeenCalled()
    expect(completed.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        type: 'xhr',
        method: 'POST',
        requestIndex: startEvent.requestIndex,
        status: 202,
        url: jasmine.stringMatching(/\/api\/orders$/),
        xhr
      })
    )

    tracking.stop()
  })

  it('should notify fetch start and completion after the cloned response stream is consumed', (done) => {
    const lifeCycle = new LifeCycle()
    const tracer = {
      traceFetch: jasmine.createSpy('traceFetch'),
      clearTracingIfNeeded: jasmine.createSpy('clearTracingIfNeeded')
    }
    const started = jasmine.createSpy('started')
    const completed = jasmine.createSpy('completed')
    let resolveFetch
    const response = {
      status: 206,
      type: 'basic',
      clone: jasmine.createSpy('clone').and.returnValue({
        body: {
          getReader() {
            return {
              read: jasmine
                .createSpy('read')
                .and.returnValues(
                  Promise.resolve({ done: false, value: new Uint8Array([1, 2]) }),
                  Promise.resolve({ done: true })
                ),
              cancel: jasmine.createSpy('cancel').and.returnValue(Promise.resolve())
            }
          }
        }
      })
    }

    window.fetch = jasmine.createSpy('fetch').and.returnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    )

    lifeCycle.subscribe(LifeCycleEventType.REQUEST_STARTED, started)
    lifeCycle.subscribe(LifeCycleEventType.REQUEST_COMPLETED, completed)

    const tracking = trackFetch(lifeCycle, configuration, tracer)

    window.fetch('/api/orders', { method: 'patch', headers: { foo: 'bar' } })

    const startEvent = started.calls.mostRecent().args[0]
    expect(startEvent).toEqual(
      jasmine.objectContaining({
        requestIndex: jasmine.any(Number),
        url: jasmine.stringMatching(/\/api\/orders$/)
      })
    )
    expect(tracer.traceFetch).toHaveBeenCalled()

    resolveFetch(response)

    Promise.resolve()
      .then(() => Promise.resolve())
      .then(() => {
        setTimeout(() => {
        expect(tracer.clearTracingIfNeeded).toHaveBeenCalled()
        expect(completed.calls.mostRecent().args[0]).toEqual(
          jasmine.objectContaining({
            type: 'fetch',
            method: 'PATCH',
            requestIndex: startEvent.requestIndex,
            status: 206,
            response,
            responseType: '',
            requestHeaderContexts: { foo: 'bar' },
            url: jasmine.stringMatching(/\/api\/orders$/)
          })
        )
        tracking.stop()
        done()
        }, 0)
      })
  })

  it('should fallback to an immediate fetch completion when response cloning fails', (done) => {
    const lifeCycle = new LifeCycle()
    const tracer = {
      traceFetch: jasmine.createSpy('traceFetch'),
      clearTracingIfNeeded: jasmine.createSpy('clearTracingIfNeeded')
    }
    const completed = jasmine.createSpy('completed')
    let resolveFetch
    const response = {
      status: 200,
      clone() {
        throw new Error('clone failed')
      }
    }

    window.fetch = jasmine.createSpy('fetch').and.returnValue(
      new Promise((resolve) => {
        resolveFetch = resolve
      })
    )

    lifeCycle.subscribe(LifeCycleEventType.REQUEST_COMPLETED, completed)

    const tracking = trackFetch(lifeCycle, configuration, tracer)
    window.fetch('/api/clone-failure')
    resolveFetch(response)

    Promise.resolve().then(() => {
      expect(completed.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({
          type: 'fetch',
          status: 200,
          duration: jasmine.any(Number),
          url: jasmine.stringMatching(/\/api\/clone-failure$/)
        })
      )
      tracking.stop()
      done()
    })
  })
})
