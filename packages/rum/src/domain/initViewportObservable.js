import {
  Observable,
  throttle,
  addEventListener,
  DOM_EVENT
} from '@cloudcare/browser-core'

var viewportObservable

export function initViewportObservable() {
  if (!viewportObservable) {
    viewportObservable = createViewportObservable()
  }
  return viewportObservable
}

export function createViewportObservable() {
  return new Observable(function (observable) {
    var _throttledUpdateDimension = throttle(function () {
      observable.notify(getViewportDimension())
    }, 200)
    var updateDimension = _throttledUpdateDimension.throttled
    return addEventListener(window, DOM_EVENT.RESIZE, updateDimension, {
      capture: true,
      passive: true
    }).stop
  })
}

// excludes the width and height of any rendered classic scrollbar that is fixed to the visual viewport
export function getViewportDimension() {
  var visual = window.visualViewport
  if (visual) {
    return {
      width: Number(visual.width * visual.scale),
      height: Number(visual.height * visual.scale)
    }
  }

  return {
    width: Number(window.innerWidth || 0),
    height: Number(window.innerHeight || 0)
  }
}
