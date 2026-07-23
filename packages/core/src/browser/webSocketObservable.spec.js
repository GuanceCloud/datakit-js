import {
  computeWebSocketPayloadSize,
  initWebSocketObservable,
  resetWebSocketObservable
} from './webSocketObservable'

class FakeWebSocket extends EventTarget {
  constructor(url, protocols) {
    super()
    const resolvedUrl = new URL(String(url), location.href)
    if (resolvedUrl.protocol === 'http:') {
      resolvedUrl.protocol = 'ws:'
    } else if (resolvedUrl.protocol === 'https:') {
      resolvedUrl.protocol = 'wss:'
    }
    this.url = resolvedUrl.href
    this.protocol = typeof protocols === 'string' ? protocols : ''
    this.bufferedAmount = 0
    this.sent = []
    this.onopen = null
    this.onmessage = null
    this.onclose = null
  }

  send(data) {
    this.sent.push(data)
  }

  simulateOpen() {
    const event = new Event('open')
    this.dispatchEvent(event)
    if (this.onopen) {
      this.onopen(event)
    }
  }

  simulateMessage(data) {
    const event = new MessageEvent('message', { data })
    this.dispatchEvent(event)
    if (this.onmessage) {
      this.onmessage(event)
    }
  }

  simulateClose(code, reason, wasClean) {
    const event = new Event('close')
    event.code = code
    event.reason = reason
    event.wasClean = wasClean
    this.dispatchEvent(event)
    if (this.onclose) {
      this.onclose(event)
    }
  }
}

FakeWebSocket.CONNECTING = 0
FakeWebSocket.OPEN = 1
FakeWebSocket.CLOSING = 2
FakeWebSocket.CLOSED = 3

describe('webSocketObservable', () => {
  let OriginalWebSocket
  let subscription
  let contexts

  beforeEach(() => {
    OriginalWebSocket = window.WebSocket
    window.WebSocket = FakeWebSocket
    contexts = []
    subscription = initWebSocketObservable().subscribe(function (context) {
      contexts.push(context)
    })
  })

  afterEach(() => {
    subscription.unsubscribe()
    resetWebSocketObservable()
    window.WebSocket = OriginalWebSocket
  })

  function findContexts(state) {
    return contexts.filter(function (context) {
      return context.state === state
    })
  }

  it('should report the resolved URL and copied protocols on construction', () => {
    const protocols = ['chat.v1', 'json']
    const webSocket = new window.WebSocket('/socket', protocols)
    protocols.push('mutated')

    const connecting = findContexts('connecting')[0]
    expect(connecting.instance).toBe(webSocket)
    expect(connecting.url).toBe(webSocket.url)
    expect(connecting.protocols).toEqual(['chat.v1', 'json'])
    expect(connecting.startClocks).toEqual({
      relative: jasmine.any(Number),
      timeStamp: jasmine.any(Number)
    })
  })

  it('should report open, incoming, outgoing and close contexts', () => {
    const webSocket = new window.WebSocket('wss://example.com/socket', 'chat')
    webSocket.protocol = 'chat'
    webSocket.bufferedAmount = 12

    webSocket.simulateOpen()
    webSocket.simulateMessage('你好')
    webSocket.send(new Uint8Array(4))
    webSocket.simulateClose(1000, 'done', true)

    expect(findContexts('open')[0]).toEqual(
      jasmine.objectContaining({
        instance: webSocket,
        protocol: 'chat'
      })
    )
    expect(findContexts('message-in')[0].size).toBe(6)
    expect(findContexts('message-out')[0]).toEqual(
      jasmine.objectContaining({
        instance: webSocket,
        size: 4,
        bufferedAmountPreSend: 12
      })
    )
    expect(webSocket.sent).toEqual([jasmine.any(Uint8Array)])
    expect(findContexts('closed')[0]).toEqual(
      jasmine.objectContaining({
        instance: webSocket,
        code: 1000,
        reason: 'done',
        wasClean: true
      })
    )
  })

  it('should preserve customer event handlers', () => {
    const webSocket = new window.WebSocket('wss://example.com/socket')
    webSocket.onopen = jasmine.createSpy('onopen')
    webSocket.onmessage = jasmine.createSpy('onmessage')
    webSocket.onclose = jasmine.createSpy('onclose')

    webSocket.simulateOpen()
    webSocket.simulateMessage('hello')
    webSocket.simulateClose(1000, '', true)

    expect(webSocket.onopen).toHaveBeenCalledTimes(1)
    expect(webSocket.onmessage).toHaveBeenCalledTimes(1)
    expect(webSocket.onclose).toHaveBeenCalledTimes(1)
  })

  it('should compute supported payload sizes without reading their content', () => {
    expect(computeWebSocketPayloadSize('你好')).toBe(6)
    expect(computeWebSocketPayloadSize(new ArrayBuffer(8))).toBe(8)
    expect(
      computeWebSocketPayloadSize(new Uint8Array(new ArrayBuffer(20), 2, 10))
    ).toBe(10)
    expect(computeWebSocketPayloadSize(new Blob(['hello']))).toBe(5)
    expect(computeWebSocketPayloadSize({ secret: 'ignored' })).toBe(0)
  })

  it('should restore WebSocket instrumentation after the last unsubscribe', () => {
    subscription.unsubscribe()
    subscription = { unsubscribe() {} }

    expect(window.WebSocket).toBe(FakeWebSocket)

    const webSocket = new window.WebSocket('wss://example.com/socket')
    webSocket.simulateOpen()
    webSocket.send('hello')

    expect(contexts).toEqual([])
  })
})
