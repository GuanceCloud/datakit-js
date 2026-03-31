import {
  initFetchObservable,
  resetFetchObservable
} from './fetchObservable'

describe('fetchObservable', () => {
  let originalFetch

  beforeEach(() => {
    originalFetch = window.fetch
  })

  afterEach(() => {
    window.fetch = originalFetch
    resetFetchObservable()
  })

  it('should notify before and after a successful fetch', (done) => {
    const subscriber = jasmine.createSpy('subscriber')
    let resolveFetch
    window.fetch = jasmine
      .createSpy('fetch')
      .and.returnValue(
        new Promise((resolve) => {
          resolveFetch = resolve
        })
      )

    const observable = initFetchObservable()
    const subscription = observable.subscribe(subscriber)

    window.fetch('/api/test', { method: 'post' })

    expect(subscriber.calls.count()).toBe(1)
    expect(subscriber.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({
        state: 'start',
        method: 'POST',
        url: jasmine.stringMatching(/\/api\/test$/)
      })
    )

    resolveFetch(new Response('', { status: 201 }))
    Promise.resolve().then(() => {
      expect(subscriber.calls.argsFor(1)[0]).toEqual(
        jasmine.objectContaining({
          state: 'resolve',
          status: 201,
          isAborted: false
        })
      )

      subscription.unsubscribe()
      done()
    })
  })

  it('should notify aborted fetch errors', (done) => {
    const abortController = new AbortController()
    abortController.abort()
    const error = new DOMException('Aborted', 'AbortError')
    window.fetch = jasmine
      .createSpy('fetch')
      .and.returnValue(Promise.reject(error))

    const subscriber = jasmine.createSpy('subscriber')
    const observable = initFetchObservable()
    const subscription = observable.subscribe(subscriber)

    window.fetch('/api/test', { signal: abortController.signal }).catch(() => {
      expect(subscriber.calls.mostRecent().args[0]).toEqual(
        jasmine.objectContaining({
          state: 'resolve',
          status: 0,
          isAborted: true,
          error
        })
      )

      subscription.unsubscribe()
      done()
    })
  })

  it('should derive method and url from a Request input', (done) => {
    const subscriber = jasmine.createSpy('subscriber')
    let resolveFetch
    window.fetch = jasmine
      .createSpy('fetch')
      .and.returnValue(
        new Promise((resolve) => {
          resolveFetch = resolve
        })
      )

    const observable = initFetchObservable()
    const subscription = observable.subscribe(subscriber)
    const request = new Request('/api/request-input', { method: 'patch' })

    window.fetch(request)

    expect(subscriber.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({
        state: 'start',
        method: 'PATCH',
        url: jasmine.stringMatching(/\/api\/request-input$/)
      })
    )

    resolveFetch(new Response('', { status: 200 }))
    Promise.resolve().then(() => {
      subscription.unsubscribe()
      done()
    })
  })
})
