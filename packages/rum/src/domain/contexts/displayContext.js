import {
  getViewportDimension,
  initViewportObservable
} from '../initViewportObservable'

export function startDisplayContext() {
  var viewport = getViewportDimension()
  var unsubscribeViewport = initViewportObservable().subscribe(function (
    viewportDimension
  ) {
    viewport = viewportDimension
  }).unsubscribe

  return {
    get: function () {
      return { viewport: viewport }
    },
    stop: unsubscribeViewport
  }
}
