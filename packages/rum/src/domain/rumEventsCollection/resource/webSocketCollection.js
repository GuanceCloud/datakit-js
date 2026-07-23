import {
  clocksNow,
  elapsed,
  initWebSocketObservable,
  LifeCycleEventType,
  UUID
} from '@cloudcare/browser-core'

export function startWebSocketCollection(
  lifeCycle,
  viewContexts,
  webSocketContextObservable
) {
  var tracker = trackWebSocket(
    lifeCycle,
    webSocketContextObservable || initWebSocketObservable(),
    viewContexts
  )
  var sessionExpiredSubscription = lifeCycle.subscribe(
    LifeCycleEventType.SESSION_EXPIRED,
    function () {
      tracker.flushOpenConnections('session_end')
    }
  )

  return {
    stop: function () {
      sessionExpiredSubscription.unsubscribe()
      tracker.flushOpenConnections('session_end')
      tracker.stop()
    }
  }
}

export function trackWebSocket(
  lifeCycle,
  webSocketContextObservable,
  viewContexts
) {
  var registry = new Map()
  var subscription = webSocketContextObservable.subscribe(function (context) {
    var connection = registry.get(context.instance)

    if (context.state === 'connecting') {
      var startView = viewContexts.findView(context.startClocks.relative)
      registry.set(context.instance, {
        webSocket: context.instance,
        connectionId: UUID(),
        url: context.url,
        startClocks: context.startClocks,
        startViewId: startView && startView.id,
        messagesIn: { count: 0, size: 0 },
        messagesOut: { count: 0, size: 0 },
        longestInboundSilence: 0,
        bufferedAmountMax: 0
      })
      return
    }

    if (!connection) {
      return
    }

    if (context.state === 'open') {
      connection.openClocks = context.openClocks
      connection.protocol = context.protocol
      connection.setupDuration = elapsed(
        connection.startClocks.timeStamp,
        context.openClocks.timeStamp
      )
      return
    }

    if (context.state === 'message-in') {
      connection.messagesIn.count += 1
      connection.messagesIn.size += context.size
      recordMessageTiming(connection, context.at, 'in')
      return
    }

    if (context.state === 'message-out') {
      connection.messagesOut.count += 1
      connection.messagesOut.size += context.size
      connection.bufferedAmountMax = Math.max(
        connection.bufferedAmountMax,
        context.bufferedAmountPreSend
      )
      recordMessageTiming(connection, context.at, 'out')
      return
    }

    if (context.state === 'closed') {
      registry.delete(context.instance)
      lifeCycle.notify(
        LifeCycleEventType.WEBSOCKET_COMPLETED,
        buildCompletedEvent(
          connection,
          context,
          'close_event',
          viewContexts
        )
      )
    }
  })

  return {
    flushOpenConnections: function (reason) {
      var at = clocksNow()
      registry.forEach(function (connection) {
        lifeCycle.notify(
          LifeCycleEventType.WEBSOCKET_COMPLETED,
          buildCompletedEvent(connection, { at: at }, reason, viewContexts)
        )
      })
      registry.clear()
    },
    stop: function () {
      subscription.unsubscribe()
      registry.clear()
    }
  }
}

function recordMessageTiming(connection, at, direction) {
  if (!connection.openClocks) {
    return
  }

  var offset = elapsed(connection.openClocks.timeStamp, at.timeStamp)
  if (direction === 'in' && connection.firstMessageInOffset === undefined) {
    connection.firstMessageInOffset = offset
  } else if (
    direction === 'out' &&
    connection.firstMessageOutOffset === undefined
  ) {
    connection.firstMessageOutOffset = offset
  }

  if (direction === 'in') {
    if (connection.lastMessageInAt !== undefined) {
      connection.longestInboundSilence = Math.max(
        connection.longestInboundSilence,
        elapsed(connection.lastMessageInAt, at.timeStamp)
      )
    }
    connection.lastMessageInAt = at.timeStamp
  }
}

function buildCompletedEvent(
  connection,
  endInfo,
  trackingEndReason,
  viewContexts
) {
  var endClocks = endInfo.at
  var endView = viewContexts.findView(
    endClocks.relative,
    trackingEndReason === 'session_end'
      ? { returnInactive: true }
      : undefined
  )

  return {
    webSocket: connection.webSocket,
    connectionId: connection.connectionId,
    url: connection.url,
    protocol: connection.protocol,
    startClocks: connection.startClocks,
    endClocks: endClocks,
    startViewId: connection.startViewId,
    endViewId: endView && endView.id,
    messagesIn: connection.messagesIn,
    messagesOut: connection.messagesOut,
    firstMessageInOffset: connection.firstMessageInOffset,
    firstMessageOutOffset: connection.firstMessageOutOffset,
    lastMessageInAt: connection.lastMessageInAt,
    longestInboundSilence: connection.longestInboundSilence,
    bufferedAmountMax: connection.bufferedAmountMax,
    inboundIdleDurationBeforeClose:
      connection.lastMessageInAt === undefined
        ? undefined
        : elapsed(connection.lastMessageInAt, endClocks.timeStamp),
    closeCode: endInfo.code,
    closeReason: endInfo.reason,
    wasClean: endInfo.wasClean,
    handshakeSucceeded: connection.openClocks !== undefined,
    trackingEndReason: trackingEndReason,
    setupDuration:
      connection.setupDuration === undefined
        ? elapsed(connection.startClocks.timeStamp, endClocks.timeStamp)
        : connection.setupDuration
  }
}
