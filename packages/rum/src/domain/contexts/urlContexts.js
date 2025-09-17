import {
  LifeCycleEventType,
  SESSION_TIME_OUT_DELAY,
  relativeNow,
  createValueHistory,
  replaceNumberCharByPath,
  getQueryParamsFromUrl,
  isHashAnAnchor,
  getPathFromHash
} from '@cloudcare/browser-core'

/**
 * We want to attach to an event:
 * - the url corresponding to its start
 * - the referrer corresponding to the previous view url (or document referrer for initial view)
 */

export var URL_CONTEXT_TIME_OUT_DELAY = SESSION_TIME_OUT_DELAY

export function startUrlContexts(
  lifeCycle,
  locationChangeObservable,
  location
) {
  var urlContextHistory = createValueHistory({
    expireDelay: URL_CONTEXT_TIME_OUT_DELAY
  })

  var previousViewUrl

  lifeCycle.subscribe(LifeCycleEventType.BEFORE_VIEW_CREATED, function (data) {
    var viewUrl = location.href
    urlContextHistory.add(
      buildUrlContext({
        url: viewUrl,
        location: location,
        referrer: !previousViewUrl ? document.referrer : previousViewUrl
      }),
      data.startClocks.relative
    )
    previousViewUrl = viewUrl
  })
  lifeCycle.subscribe(LifeCycleEventType.AFTER_VIEW_ENDED, function (data) {
    urlContextHistory.closeActive(data.endClocks.relative)
  })
  var locationChangeSubscription = locationChangeObservable.subscribe(function (
    data
  ) {
    var current = urlContextHistory.find()
    if (current) {
      var changeTime = relativeNow()
      urlContextHistory.closeActive(changeTime)
      urlContextHistory.add(
        buildUrlContext(
          {
            url: data.newLocation.href,
            location: data.newLocation,
            referrer: current.referrer
          },
          true
        ),
        changeTime
      )
    }
  })

  function buildUrlContext(data, isLocationChange = false) {
    var pathname = data.location.pathname
    var path = pathname
    var hash = data.location.hash
    if (hash && hash.indexOf('#/') === 0) {
      path = '/' + getPathFromHash(hash)
    }
    return {
      url: data.url,
      referrer: data.referrer,
      host: data.location.host,
      path: path,
      pathGroup: replaceNumberCharByPath(path),
      urlQuery: getQueryParamsFromUrl(data.location.href),
      pathname: pathname
    }
  }

  return {
    findUrl: function (startTime) {
      return urlContextHistory.find(startTime)
    },
    stop: function () {
      locationChangeSubscription.unsubscribe()
      urlContextHistory.stop()
    }
  }
}
