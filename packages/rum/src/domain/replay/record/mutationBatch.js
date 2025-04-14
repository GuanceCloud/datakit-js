import { noop, throttle, requestIdleCallback } from '@cloudcare/browser-core'

/**
 * Maximum duration to wait before processing mutations. If the browser is idle, mutations will be
 * processed more quickly. If the browser is busy executing small tasks (ex: rendering frames), the
 * mutations will wait MUTATION_PROCESS_MAX_DELAY milliseconds before being processed. If the
 * browser is busy executing a longer task, mutations will be processed after this task.
 */
var MUTATION_PROCESS_MAX_DELAY = 100
export var MUTATION_PROCESS_MIN_DELAY = 16
export function createMutationBatch(processMutationBatch) {
  var cancelScheduledFlush = noop
  var pendingMutations = []

  function flush() {
    cancelScheduledFlush()
    processMutationBatch(pendingMutations)
    pendingMutations = []
  }
  //const { throttled: throttledFlush, cancel: cancelThrottle }
  var _throttled = throttle(flush, MUTATION_PROCESS_MIN_DELAY, {
    leading: false
  })
  var throttledFlush = _throttled.throttled
  var cancelThrottle = _throttled.cancel
  return {
    addMutations: function (mutations) {
      if (pendingMutations.length === 0) {
        cancelScheduledFlush = requestIdleCallback(throttledFlush, {
          timeout: MUTATION_PROCESS_MAX_DELAY
        })
      }
      Array.prototype.push.apply(pendingMutations, mutations)
    },

    flush: flush,

    stop: function () {
      cancelScheduledFlush()
      cancelThrottle()
    }
  }
}
