import { initXhrObservable } from './xhrObservable'

describe('xhrObservable', () => {
  let OriginalXMLHttpRequest

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
    OriginalXMLHttpRequest = window.XMLHttpRequest
    window.XMLHttpRequest = FakeXMLHttpRequest
  })

  afterEach(() => {
    window.XMLHttpRequest = OriginalXMLHttpRequest
  })

  it('should notify start and complete states for xhr requests', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = initXhrObservable()
    const subscription = observable.subscribe(subscriber)
    const xhr = new XMLHttpRequest()

    xhr.open('post', '/xhr/test')
    xhr.setRequestHeader('x-test', 'value')
    xhr.send()

    expect(subscriber.calls.argsFor(0)[0]).toEqual(
      jasmine.objectContaining({
        state: 'start',
        method: 'POST',
        url: jasmine.stringMatching(/\/xhr\/test$/),
        isAborted: false,
        requestHeaderContexts: {
          'x-test': 'value'
        }
      })
    )

    xhr.status = 204
    xhr.readyState = XMLHttpRequest.DONE
    xhr.dispatchEvent(new Event('loadend'))

    expect(subscriber.calls.argsFor(1)[0]).toEqual(
      jasmine.objectContaining({
        state: 'complete',
        status: 204,
        isAborted: false
      })
    )

    subscription.unsubscribe()
  })

  it('should mark aborted requests', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = initXhrObservable()
    const subscription = observable.subscribe(subscriber)
    const xhr = new XMLHttpRequest()

    xhr.open('get', '/xhr/test')
    xhr.send()
    xhr.abort()
    xhr.status = 0
    xhr.readyState = XMLHttpRequest.DONE
    xhr.dispatchEvent(new Event('loadend'))

    expect(subscriber.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        state: 'complete',
        status: 0,
        isAborted: true
      })
    )

    subscription.unsubscribe()
  })

  it('should ignore send calls when open was not called first', () => {
    const subscriber = jasmine.createSpy('subscriber')
    const observable = initXhrObservable()
    const subscription = observable.subscribe(subscriber)
    const xhr = new XMLHttpRequest()

    xhr.send()

    expect(subscriber).not.toHaveBeenCalled()

    subscription.unsubscribe()
  })
})
