import { Observable } from '../helper/observable'
import { clearTimeout, setTimeout } from '../helper/timer'

// type FlushReason = PageExitReason | 'duration_limit' | 'bytes_limit' | 'messages_limit' | 'session_expire'

/**
 * Returns a "flush controller", responsible of notifying when flushing a pool of pending data needs
 * to happen. The implementation is designed to support both synchronous and asynchronous usages,
 * but relies on invariants described in each method documentation to keep a coherent state.
 */
export function createFlushController({
  messagesLimit,
  bytesLimit,
  durationLimit,
  pageExitObservable,
  sessionExpireObservable
}) {
  var pageExitSubscription = pageExitObservable.subscribe(function (event) {
    return flush(event.reason)
  })
  var sessionExpireSubscription = sessionExpireObservable.subscribe(
    function () {
      return flush('session_expire')
    }
  )
  var flushObservable = new Observable(function () {
    return function () {
      pageExitSubscription.unsubscribe()
      sessionExpireSubscription.unsubscribe()
    }
  })

  var currentBytesCount = 0
  var currentMessagesCount = 0

  function flush(flushReason) {
    if (currentMessagesCount === 0) {
      return
    }

    var messagesCount = currentMessagesCount
    var bytesCount = currentBytesCount

    currentMessagesCount = 0
    currentBytesCount = 0
    cancelDurationLimitTimeout()

    flushObservable.notify({
      reason: flushReason,
      messagesCount: messagesCount,
      bytesCount: bytesCount
    })
  }

  var durationLimitTimeoutId
  function scheduleDurationLimitTimeout() {
    if (durationLimitTimeoutId === undefined) {
      durationLimitTimeoutId = setTimeout(function () {
        flush('duration_limit')
      }, durationLimit)
    }
  }

  function cancelDurationLimitTimeout() {
    clearTimeout(durationLimitTimeoutId)
    durationLimitTimeoutId = undefined
  }

  return {
    flushObservable: flushObservable,
    getMessagesCount: function () {
      return currentMessagesCount
    },

    /**
     * Notifies that a message will be added to a pool of pending messages waiting to be flushed.
     *
     * This function needs to be called synchronously, right before adding the message, so no flush
     * event can happen after `notifyBeforeAddMessage` and before adding the message.
     */
    notifyBeforeAddMessage: function (estimatedMessageBytesCount) {
      if (currentBytesCount + estimatedMessageBytesCount >= bytesLimit) {
        flush('bytes_limit')
      }
      // Consider the message to be added now rather than in `notifyAfterAddMessage`, because if no
      // message was added yet and `notifyAfterAddMessage` is called asynchronously, we still want
      // to notify when a flush is needed (for example on page exit).
      currentMessagesCount += 1
      currentBytesCount += estimatedMessageBytesCount
      scheduleDurationLimitTimeout()
    },

    /**
     * Notifies that a message *was* added to a pool of pending messages waiting to be flushed.
     *
     * This function can be called asynchronously after the message was added, but in this case it
     * should not be called if a flush event occurred in between.
     */
    notifyAfterAddMessage: function (messageBytesCountDiff) {
      if (messageBytesCountDiff === undefined) {
        messageBytesCountDiff = 0
      }
      currentBytesCount += messageBytesCountDiff

      if (currentMessagesCount >= messagesLimit) {
        flush('messages_limit')
      } else if (currentBytesCount >= bytesLimit) {
        flush('bytes_limit')
      }
    },

    /**
     * Notifies that a message was removed from a pool of pending messages waiting to be flushed.
     *
     * This function needs to be called synchronously, right after removing the message, so no flush
     * event can happen after removing the message and before `notifyAfterRemoveMessage`.
     *
     * @param messageBytesCount: the message bytes count that was added to the pool. Should
     * correspond to the sum of bytes counts passed to `notifyBeforeAddMessage` and
     * `notifyAfterAddMessage`.
     */
    notifyAfterRemoveMessage: function (messageBytesCount) {
      currentBytesCount -= messageBytesCount
      currentMessagesCount -= 1
      if (currentMessagesCount === 0) {
        cancelDurationLimitTimeout()
      }
    }
  }
}
