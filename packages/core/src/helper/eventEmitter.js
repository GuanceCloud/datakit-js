import { each } from './tools'
var EventEmitter = function () {
  this._events = []
  this.pendingEvents = []
}

EventEmitter.prototype = {
  emit: function (type) {
    var args = [].slice.call(arguments, 1)
    each(this._events, function (val) {
      if (val.type !== type) {
        return false
      }
      val.callback.apply(val.context, args)
    })
  },
  on: function (event, callback, context) {
    if (typeof callback !== 'function') {
      return
    }
    this._events.push({
      type: event,
      callback: callback,
      context: context || this
    })
  }
}
export var eventEmitter = new EventEmitter()
