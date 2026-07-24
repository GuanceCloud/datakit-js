import {
  clocksNow,
  elapsed,
  initWebSocketObservable,
  LifeCycleEventType,
  PageExitReason,
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
      tracker.flushOpenConnections('session_end', true)
    }
  )
  var sessionRenewedSubscription = lifeCycle.subscribe(
    LifeCycleEventType.SESSION_RENEWED,
    function () {
      tracker.resumeOpenConnections()
    }
  )
  var pageExitSubscription = lifeCycle.subscribe(
    LifeCycleEventType.PAGE_EXITED,
    function (event) {
      if (event.reason === PageExitReason.UNLOADING) {
        tracker.flushOpenConnections('page_exit')
      }
    }
  )

  return {
    stop: function () {
      sessionExpiredSubscription.unsubscribe()
      sessionRenewedSubscription.unsubscribe()
      pageExitSubscription.unsubscribe()
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
  var isWaitingForSessionRenewal = false
  var subscription = webSocketContextObservable.subscribe(function (context) {
    var connection = registry.get(context.instance)

    if (context.state === 'connecting') {
      connection = createConnection(
        context.instance,
        context.url,
        context.startClocks,
        viewContexts
      )
      connection.pendingSessionRenewal = isWaitingForSessionRenewal
      registry.set(context.instance, connection)
      return
    }

    if (!connection) {
      return
    }

    if (connection.pendingSessionRenewal) {
      if (context.state === 'open') {
        connection.openClocks = context.openClocks
        connection.protocol = context.protocol
      } else if (context.state === 'closed') {
        registry.delete(context.instance)
      }
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
    flushOpenConnections: function (reason, preserveConnections) {
      var at = clocksNow()
      isWaitingForSessionRenewal = !!preserveConnections
      registry.forEach(function (connection) {
        if (connection.pendingSessionRenewal) {
          return
        }
        lifeCycle.notify(
          LifeCycleEventType.WEBSOCKET_COMPLETED,
          buildCompletedEvent(connection, { at: at }, reason, viewContexts)
        )
        if (preserveConnections) {
          connection.pendingSessionRenewal = true
        }
      })
      if (!preserveConnections) {
        registry.clear()
      }
    },
    resumeOpenConnections: function () {
      var at = clocksNow()
      isWaitingForSessionRenewal = false
      registry.forEach(function (connection) {
        if (connection.pendingSessionRenewal) {
          resetConnectionSegment(connection, at, viewContexts)
        }
      })
    },
    stop: function () {
      subscription.unsubscribe()
      registry.clear()
    }
  }
}

function createConnection(webSocket, url, startClocks, viewContexts) {
  var connection = {
    webSocket: webSocket,
    connectionId: UUID(),
    url: url
  }
  resetConnectionSegment(connection, startClocks, viewContexts)
  return connection
}

function resetConnectionSegment(connection, startClocks, viewContexts) {
  var wasOpen = connection.openClocks !== undefined
  var startView = viewContexts.findView(startClocks.relative)

  connection.startClocks = startClocks
  connection.startViewId = startView && startView.id
  connection.messagesIn = { count: 0, size: 0 }
  connection.messagesOut = { count: 0, size: 0 }
  connection.longestInboundSilence = 0
  connection.bufferedAmountMax = 0
  connection.pendingSessionRenewal = false

  delete connection.firstMessageInOffset
  delete connection.firstMessageOutOffset
  delete connection.lastMessageInAt

  if (wasOpen) {
    connection.openClocks = startClocks
    connection.setupDuration = 0
  } else {
    delete connection.openClocks
    delete connection.setupDuration
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
    trackingEndReason === 'session_end' || trackingEndReason === 'page_exit'
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
