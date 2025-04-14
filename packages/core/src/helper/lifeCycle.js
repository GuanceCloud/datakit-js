import { each, filter } from './tools'
export var LifeCycleEventType = {
  AUTO_ACTION_COMPLETED: 'AUTO_ACTION_COMPLETED',
  BEFORE_VIEW_CREATED: 'BEFORE_VIEW_CREATED',
  VIEW_CREATED: 'VIEW_CREATED',
  VIEW_UPDATED: 'VIEW_UPDATED',
  BEFORE_VIEW_UPDATED: 'BEFORE_VIEW_UPDATED',
  VIEW_ENDED: 'VIEW_ENDED',
  AFTER_VIEW_ENDED: 'AFTER_VIEW_ENDED',
  SESSION_RENEWED: 'SESSION_RENEWED',
  SESSION_EXPIRED: 'SESSION_EXPIRED',
  PAGE_EXITED: 'PAGE_EXITED',
  REQUEST_STARTED: 'REQUEST_STARTED',
  REQUEST_COMPLETED: 'REQUEST_COMPLETED',
  RAW_RUM_EVENT_COLLECTED: 'RAW_RUM_EVENT_COLLECTED',
  RUM_EVENT_COLLECTED: 'RUM_EVENT_COLLECTED',
  RAW_ERROR_COLLECTED: 'RAW_ERROR_COLLECTED',
  RAW_LOG_COLLECTED: 'RAW_LOG_COLLECTED',
  LOG_COLLECTED: 'LOG_COLLECTED'
}
export function LifeCycle() {
  this.callbacks = {}
}
LifeCycle.prototype = {
  notify: function (eventType, data) {
    var eventCallbacks = this.callbacks[eventType]
    if (eventCallbacks) {
      each(eventCallbacks, function (callback) {
        callback(data)
      })
    }
  },
  subscribe: function (eventType, callback) {
    if (!this.callbacks[eventType]) {
      this.callbacks[eventType] = []
    }
    this.callbacks[eventType].push(callback)
    var _this = this
    return {
      unsubscribe: function () {
        _this.callbacks[eventType] = filter(
          _this.callbacks[eventType],
          function (other) {
            return other !== callback
          }
        )
      }
    }
  }
}
