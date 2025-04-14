import { ErrorSource } from './errorTools'
import { clocksNow, ONE_MINUTE } from './tools'
import { setTimeout } from './timer'
export function createEventRateLimiter(eventType, limit, onLimitReached) {
  var eventCount = 0
  var allowNextEvent = false
  return {
    isLimitReached: function () {
      if (eventCount === 0) {
        setTimeout(function () {
          eventCount = 0
        }, ONE_MINUTE)
      }
      eventCount += 1
      if (eventCount <= limit || allowNextEvent) {
        allowNextEvent = false
        return false
      }
      if (eventCount === limit + 1) {
        allowNextEvent = true
        try {
          onLimitReached({
            message:
              'Reached max number of ' + eventType + 's by minute: ' + limit,
            source: ErrorSource.AGENT,
            startClocks: clocksNow()
          })
        } finally {
          allowNextEvent = false
        }
      }
      return true
    }
  }
}
