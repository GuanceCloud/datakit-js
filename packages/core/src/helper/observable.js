import { each, filter, map } from './tools'
var _Observable = function (onFirstSubscribe) {
  this.observers = []
  this.onLastUnsubscribe = undefined
  this.onFirstSubscribe = onFirstSubscribe
}
_Observable.prototype = {
  subscribe: function (f) {
    this.observers.push(f)
    if (this.observers.length === 1 && this.onFirstSubscribe) {
      this.onLastUnsubscribe = this.onFirstSubscribe(this) || undefined
    }
    var _this = this
    return {
      unsubscribe: function () {
        _this.observers = filter(_this.observers, function (other) {
          return f !== other
        })
        if (!_this.observers.length && _this.onLastUnsubscribe) {
          _this.onLastUnsubscribe()
        }
      }
    }
  },
  notify: function (data) {
    each(this.observers, function (observer) {
      observer(data)
    })
  }
}
export var Observable = _Observable

export function mergeObservables() {
  var observables = [].slice.call(arguments)
  return new Observable(function (globalObservable) {
    var subscriptions = map(observables, function (observable) {
      return observable.subscribe(function (data) {
        return globalObservable.notify(data)
      })
    })
    return function () {
      return each(subscriptions, function (subscription) {
        return subscription.unsubscribe()
      })
    }
  })
}
