import {
  clocksNow,
  LifeCycle,
  LifeCycleEventType,
  Observable,
  PageExitReason
} from '@cloudcare/browser-core'
import {
  startWebSocketCollection,
  trackWebSocket
} from './webSocketCollection'

describe('webSocketCollection', () => {
  let lifeCycle
  let observable
  let completed
  let viewContexts

  beforeEach(() => {
    lifeCycle = new LifeCycle()
    observable = new Observable()
    completed = []
    viewContexts = {
      findView: jasmine.createSpy('findView').and.callFake(function (time) {
        return { id: time < 50 ? 'view-a' : 'view-b' }
      })
    }
    lifeCycle.subscribe(
      LifeCycleEventType.WEBSOCKET_COMPLETED,
      function (event) {
        completed.push(event)
      }
    )
  })

  function clocks(relative, timeStamp) {
    return { relative: relative, timeStamp: timeStamp }
  }

  function notify(state, instance, properties) {
    observable.notify({
      state: state,
      instance: instance,
      ...properties
    })
  }

  it('should aggregate connection quality metrics until close', () => {
    const webSocket = {}
    trackWebSocket(lifeCycle, observable, viewContexts)

    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })
    notify('open', webSocket, {
      protocol: 'chat.v1',
      openClocks: clocks(10, 1010)
    })
    notify('message-in', webSocket, {
      size: 6,
      at: clocks(20, 1020)
    })
    notify('message-out', webSocket, {
      size: 4,
      bufferedAmountPreSend: 8,
      at: clocks(30, 1030)
    })
    notify('message-out', webSocket, {
      size: 5,
      bufferedAmountPreSend: 20,
      at: clocks(40, 1040)
    })
    notify('message-in', webSocket, {
      size: 10,
      at: clocks(50, 1050)
    })
    notify('closed', webSocket, {
      code: 1000,
      reason: 'done',
      wasClean: true,
      at: clocks(100, 1100)
    })

    expect(completed).toEqual([
      jasmine.objectContaining({
        webSocket: webSocket,
        url: 'wss://example.com/socket',
        protocol: 'chat.v1',
        startViewId: 'view-a',
        endViewId: 'view-b',
        messagesIn: { count: 2, size: 16 },
        messagesOut: { count: 2, size: 9 },
        firstMessageInOffset: 10,
        firstMessageOutOffset: 20,
        lastMessageInAt: 1050,
        longestInboundSilence: 30,
        inboundIdleDurationBeforeClose: 50,
        bufferedAmountMax: 20,
        closeCode: 1000,
        closeReason: 'done',
        wasClean: true,
        handshakeSucceeded: true,
        trackingEndReason: 'close_event',
        setupDuration: 10
      })
    ])
    expect(completed[0].connectionId).toEqual(jasmine.any(String))
  })

  it('should handle failed handshakes and overlapping connections independently', () => {
    const first = {}
    const second = {}
    trackWebSocket(lifeCycle, observable, viewContexts)

    notify('connecting', first, {
      url: 'wss://example.com/first',
      startClocks: clocks(0, 1000)
    })
    notify('connecting', second, {
      url: 'wss://example.com/second',
      startClocks: clocks(5, 1005)
    })
    notify('open', second, {
      protocol: '',
      openClocks: clocks(10, 1010)
    })
    notify('closed', first, {
      code: 1006,
      reason: 'abnormal',
      wasClean: false,
      at: clocks(25, 1025)
    })
    notify('closed', second, {
      code: 1000,
      reason: '',
      wasClean: true,
      at: clocks(30, 1030)
    })

    expect(completed.length).toBe(2)
    expect(completed[0]).toEqual(
      jasmine.objectContaining({
        handshakeSucceeded: false,
        setupDuration: 25,
        trackingEndReason: 'close_event'
      })
    )
    expect(completed[1].handshakeSucceeded).toBeTrue()
    expect(completed[0].connectionId).not.toBe(completed[1].connectionId)
  })

  it('should split an open connection across renewed sessions', () => {
    const webSocket = {}
    const collection = startWebSocketCollection(
      lifeCycle,
      viewContexts,
      observable
    )

    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })
    notify('open', webSocket, {
      protocol: '',
      openClocks: clocks(10, 1010)
    })
    notify('message-in', webSocket, {
      size: 2,
      at: clocks(15, 1015)
    })

    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)
    notify('message-in', webSocket, {
      size: 100,
      at: clocksNow()
    })
    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)

    const renewedMessageAt = clocksNow()
    notify('message-out', webSocket, {
      size: 3,
      bufferedAmountPreSend: 4,
      at: renewedMessageAt
    })
    notify('closed', webSocket, {
      code: 1000,
      reason: '',
      wasClean: true,
      at: clocksNow()
    })

    expect(completed.length).toBe(2)
    expect(completed[0].trackingEndReason).toBe('session_end')
    expect(completed[0].messagesIn).toEqual({ count: 1, size: 2 })
    expect(
      viewContexts.findView.calls.allArgs().some(function (args) {
        return args[1] && args[1].returnInactive
      })
    ).toBeTrue()
    expect(completed[1]).toEqual(
      jasmine.objectContaining({
        trackingEndReason: 'close_event',
        messagesIn: { count: 0, size: 0 },
        messagesOut: { count: 1, size: 3 },
        bufferedAmountMax: 4,
        setupDuration: 0
      })
    )
    expect(completed[1].connectionId).toBe(completed[0].connectionId)
    expect(completed[1].startClocks.timeStamp).toBeGreaterThanOrEqual(
      completed[0].endClocks.timeStamp
    )

    collection.stop()
  })

  it('should not resume a connection closed between session expiration and renewal', () => {
    const webSocket = {}
    const collection = startWebSocketCollection(
      lifeCycle,
      viewContexts,
      observable
    )

    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })
    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)
    notify('closed', webSocket, {
      code: 1000,
      reason: '',
      wasClean: true,
      at: clocksNow()
    })
    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)

    expect(completed.length).toBe(1)
    expect(completed[0].trackingEndReason).toBe('session_end')

    collection.stop()
    expect(completed.length).toBe(1)
  })

  it('should start a connection created during the session gap on renewal', () => {
    const webSocket = {}
    const collection = startWebSocketCollection(
      lifeCycle,
      viewContexts,
      observable
    )

    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)
    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })
    notify('open', webSocket, {
      protocol: 'chat',
      openClocks: clocks(5, 1005)
    })
    notify('message-in', webSocket, {
      size: 100,
      at: clocks(10, 1010)
    })

    lifeCycle.notify(LifeCycleEventType.SESSION_RENEWED)
    notify('message-out', webSocket, {
      size: 3,
      bufferedAmountPreSend: 4,
      at: clocksNow()
    })
    notify('closed', webSocket, {
      code: 1000,
      reason: '',
      wasClean: true,
      at: clocksNow()
    })

    expect(completed.length).toBe(1)
    expect(completed[0]).toEqual(
      jasmine.objectContaining({
        trackingEndReason: 'close_event',
        protocol: 'chat',
        messagesIn: { count: 0, size: 0 },
        messagesOut: { count: 1, size: 3 },
        setupDuration: 0
      })
    )
    expect(completed[0].startClocks.timeStamp).toBeGreaterThan(1005)

    collection.stop()
  })

  it('should not settle an expired segment again when the page unloads', () => {
    const webSocket = {}
    const collection = startWebSocketCollection(
      lifeCycle,
      viewContexts,
      observable
    )

    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })
    lifeCycle.notify(LifeCycleEventType.SESSION_EXPIRED)
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })

    expect(completed.length).toBe(1)
    expect(completed[0].trackingEndReason).toBe('session_end')

    collection.stop()
    expect(completed.length).toBe(1)
  })

  it('should finalize open connections when the page unloads', () => {
    const webSocket = {}
    const collection = startWebSocketCollection(
      lifeCycle,
      viewContexts,
      observable
    )

    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })
    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.HIDDEN
    })
    expect(completed.length).toBe(0)

    lifeCycle.notify(LifeCycleEventType.PAGE_EXITED, {
      reason: PageExitReason.UNLOADING
    })
    notify('closed', webSocket, {
      code: 1000,
      reason: '',
      wasClean: true,
      at: clocks(20, 1020)
    })

    expect(completed.length).toBe(1)
    expect(completed[0].trackingEndReason).toBe('page_exit')
    expect(
      viewContexts.findView.calls.mostRecent().args[1]
    ).toEqual({ returnInactive: true })

    collection.stop()
    expect(completed.length).toBe(1)
  })

  it('should flush on stop and ignore later observable events', () => {
    const webSocket = {}
    const collection = startWebSocketCollection(
      lifeCycle,
      viewContexts,
      observable
    )
    notify('connecting', webSocket, {
      url: 'wss://example.com/socket',
      startClocks: clocks(0, 1000)
    })

    collection.stop()
    notify('closed', webSocket, {
      code: 1000,
      reason: '',
      wasClean: true,
      at: clocks(10, 1010)
    })

    expect(completed.length).toBe(1)
    expect(completed[0].trackingEndReason).toBe('session_end')
  })
})
