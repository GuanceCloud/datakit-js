import { each } from './tools'
var _Observable = function () {
  this.observers = []
}
_Observable.prototype = {
  subscribe: function (f) {
    this.observers.push(f)
  },
  notify: function (data) {
    each(this.observers, function (observer) {
      observer(data)
    })
  }
}
export var Observable = _Observable
