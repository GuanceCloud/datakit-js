import {
  addEventListener,
  DOM_EVENT,
  Observable,
  shallowClone,
  instrumentMethod
} from '@cloudcare/browser-core'

export function createLocationChangeObservable(location) {
  var currentLocation = shallowClone(location)
  return new Observable(function (observable) {
    var _trackHistory = trackHistory(onLocationChange)
    var _trackHash = trackHash(onLocationChange)
    function onLocationChange() {
      if (currentLocation.href === location.href) {
        return
      }
      var newLocation = shallowClone(location)
      observable.notify({
        newLocation: newLocation,
        oldLocation: currentLocation
      })
      currentLocation = newLocation
    }
    return function () {
      _trackHistory.stop()
      _trackHash.stop()
    }
  })
}

function trackHistory(onHistoryChange) {
  // eslint-disable-next-line @typescript-eslint/unbound-method
  var pushState = instrumentMethod(
    getHistoryInstrumentationTarget('pushState'),
    'pushState',
    function (params) {
      var onPostCall = params.onPostCall
      onPostCall(onHistoryChange)
    }
  )
  var replaceState = instrumentMethod(
    getHistoryInstrumentationTarget('replaceState'),
    'replaceState',
    function (params) {
      var onPostCall = params.onPostCall
      onPostCall(onHistoryChange)
    }
  )
  var popState = addEventListener(window, DOM_EVENT.POP_STATE, onHistoryChange)

  return {
    stop: function () {
      pushState.stop()
      replaceState.stop()
      popState.stop()
    }
  }
}

function trackHash(onHashChange) {
  return addEventListener(window, DOM_EVENT.HASH_CHANGE, onHashChange)
}
function getHistoryInstrumentationTarget(methodName) {
  // Ideally we should always instument the method on the prototype, however some frameworks (e.g [Next.js](https://github.com/vercel/next.js/blob/d3f5532065f3e3bb84fb54bd2dfd1a16d0f03a21/packages/next/src/client/components/app-router.tsx#L429))
  // are wrapping the instance method. In that case we should also wrap the instance method.
  return Object.prototype.hasOwnProperty.call(history, methodName)
    ? history
    : History.prototype
}
