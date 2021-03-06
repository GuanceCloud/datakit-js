import {
  includes,
  msToNs,
  each,
  toArray,
  extend,
  getPathName,
  isValidUrl,
  isIntakeRequest,
  ResourceType
} from '@cloudcare/browser-core'
export var FAKE_INITIAL_DOCUMENT = 'initial_document'

var RESOURCE_TYPES = [
  [
    ResourceType.DOCUMENT,
    function (initiatorType) {
      return FAKE_INITIAL_DOCUMENT === initiatorType
    }
  ],
  [
    ResourceType.XHR,
    function (initiatorType) {
      return 'xmlhttprequest' === initiatorType
    }
  ],
  [
    ResourceType.FETCH,
    function (initiatorType) {
      return 'fetch' === initiatorType
    }
  ],
  [
    ResourceType.BEACON,
    function (initiatorType) {
      return 'beacon' === initiatorType
    }
  ],
  [
    ResourceType.CSS,
    function (_, path) {
      return path.match(/\.css$/i) !== null
    }
  ],
  [
    ResourceType.JS,
    function (_, path) {
      return path.match(/\.js$/i) !== null
    }
  ],
  [
    ResourceType.IMAGE,
    function (initiatorType, path) {
      return (
        includes(['image', 'img', 'icon'], initiatorType) ||
        path.match(/\.(gif|jpg|jpeg|tiff|png|svg|ico)$/i) !== null
      )
    }
  ],
  [
    ResourceType.FONT,
    function (_, path) {
      return path.match(/\.(woff|eot|woff2|ttf)$/i) !== null
    }
  ],
  [
    ResourceType.MEDIA,
    function (initiatorType, path) {
      return (
        includes(['audio', 'video'], initiatorType) ||
        path.match(/\.(mp3|mp4)$/i) !== null
      )
    }
  ]
]

export function computeResourceKind(timing) {
  var url = timing.name
  if (!isValidUrl(url)) {
    return ResourceType.OTHER
  }
  var path = getPathName(url)
  var type = ResourceType.OTHER
  each(RESOURCE_TYPES, function (res) {
    var _type = res[0],
      isType = res[1]
    if (isType(timing.initiatorType, path)) {
      type = _type
      return false
    }
  })
  return type
}
function areInOrder() {
  var numbers = toArray(arguments)
  for (var i = 1; i < numbers.length; i += 1) {
    if (numbers[i - 1] > numbers[i]) {
      return false
    }
  }
  return true
}

export function isRequestKind(timing) {
  return (
    timing.initiatorType === 'xmlhttprequest' ||
    timing.initiatorType === 'fetch'
  )
}

export function computePerformanceResourceDuration(entry) {
  // Safari duration is always 0 on timings blocked by cross origin policies.
  if (entry.duration === 0 && entry.startTime < entry.responseEnd) {
    return msToNs(entry.responseEnd - entry.startTime)
  }

  return msToNs(entry.duration)
}
export function is304(entry) {
  if (
    entry.encodedBodySize > 0 &&
    entry.transferSize > 0 &&
    entry.transferSize < entry.encodedBodySize
  ) {
    return true
  }

  // unknown
  return null
}
export function isCacheHit(entry) {
  // if we transferred bytes, it must not be a cache hit
  // (will return false for 304 Not Modified)
  if (entry.transferSize > 0) return false

  // if the body size is non-zero, it must mean this is a
  // ResourceTiming2 browser, this was same-origin or TAO,
  // and transferSize was 0, so it was in the cache
  if (entry.decodedBodySize > 0) return true

  // fall back to duration checking (non-RT2 or cross-origin)
  return entry.duration < 30
}
//  interface PerformanceResourceDetails {
//   redirect?: PerformanceResourceDetailsElement
//   dns?: PerformanceResourceDetailsElement
//   connect?: PerformanceResourceDetailsElement
//   ssl?: PerformanceResourceDetailsElement
//   firstByte: PerformanceResourceDetailsElement
//   download: PerformanceResourceDetailsElement
//   fmp:
// }
// page_fmp	float		????????????(?????????????????????????????????????????????????????????)??????FCP??????????????????????????????????????????FCP???????????????????????????	firstPaintContentEnd - firstPaintContentStart
// page_fpt	float		????????????????????????????????????(????????????????????????????????????????????????HTML???????????????????????????)	responseEnd - fetchStart
// page_tti	float		?????????????????????(?????????????????????HTML??????????????????DOM?????????????????????????????????????????????)	domInteractive - fetchStart
// page_firstbyte	float		????????????	responseStart - domainLookupStart
// page_dom_ready	float		DOM Ready??????(??????????????????????????????JS????????????JS????????????=ready-tti???)	domContentLoadEventEnd - fetchStart
// page_load	float		????????????????????????(load=??????????????????+DOM????????????+??????JS??????+?????????????????????)	loadEventStart - fetchStart
// page_dns	float		dns????????????	domainLookupEnd - domainLookupStart
// page_tcp	float		tcp????????????	connectEnd - connectStart
// page_ssl	float		ssl??????????????????(????????????https)	connectEnd - secureConnectionStart
// page_ttfb	float		??????????????????	responseStart - requestStart
// page_trans	float		??????????????????	responseEnd - responseStart
// page_dom	float		DOM????????????	domInteractive - responseEnd
// page_resource_load_time	float		??????????????????	loadEventStart - domContentLoadedEventEnd

//  navigationStart?????????????????????????????????????????????????????????unload????????????Unix?????????????????????????????????????????????????????????fetchStart?????????

// ??   unloadEventStart??????????????????????????????????????????????????????????????????????????????????????????unload??????????????????Unix????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????0???

// ??   unloadEventEnd???????????????????????????????????????????????????????????????????????????????????????unload?????????????????????????????????Unix????????????????????????????????????????????????????????????????????????????????????????????????????????????????????????0???

// ??   redirectStart??????????????????HTTP??????????????????Unix???????????????????????????????????????????????????????????????????????????????????????????????????0???

// ??   redirectEnd?????????????????????HTTP???????????????????????????????????????????????????????????????????????????Unix???????????????????????????????????????????????????????????????????????????????????????????????????0???

// ??   fetchStart??????????????????????????????HTTP????????????????????????Unix?????????????????????????????????????????????????????????????????????

// ??   domainLookupStart?????????????????????????????????Unix????????????????????????????????????????????????????????????????????????????????????????????????????????????fetchStart???????????????

// ??   domainLookupEnd?????????????????????????????????Unix????????????????????????????????????????????????????????????????????????????????????????????????????????????fetchStart???????????????

// ??   connectStart?????????HTTP????????????????????????????????????Unix?????????????????????????????????????????????persistent connection???????????????????????????fetchStart???????????????

// ??   connectEnd?????????????????????????????????????????????????????????Unix????????????????????????????????????????????????????????????????????????fetchStart??????????????????????????????????????????????????????????????????????????????

// ??   secureConnectionStart???????????????????????????????????????????????????????????????Unix?????????????????????????????????????????????????????????????????????0???

// ??   requestStart????????????????????????????????????HTTP????????????????????????????????????????????????Unix??????????????????

// ??   responseStart???????????????????????????????????????????????????????????????????????????????????????Unix??????????????????

// ??   responseEnd????????????????????????????????????????????????????????????????????????????????????????????????????????????HTTP?????????????????????????????????????????????Unix??????????????????

// ??   domLoading?????????????????????DOM???????????????????????????Document.readyState???????????????loading???????????????readystatechange?????????????????????Unix??????????????????

// ??   domInteractive?????????????????????DOM??????????????????????????????????????????????????????Document.readyState???????????????interactive???????????????readystatechange?????????????????????Unix??????????????????

// ??   domContentLoadedEventStart?????????????????????DOMContentLoaded?????????????????????DOM??????????????????????????????????????????????????????Unix??????????????????

// ??   domContentLoadedEventEnd??????????????????????????????????????????????????????????????????Unix??????????????????

// ??   domComplete?????????????????????DOM?????????????????????Document.readyState???????????????complete?????????????????????readystatechange?????????????????????Unix??????????????????

// ??   loadEventStart?????????????????????load?????????????????????????????????Unix?????????????????????????????????????????????????????????0???

// ??   loadEventEnd?????????????????????load???????????????????????????????????????Unix?????????????????????????????????????????????????????????0
export function computePerformanceResourceDetails(entry) {
  var validEntry = toValidEntry(entry)

  if (!validEntry) {
    return undefined
  }

  var startTime = validEntry.startTime,
    fetchStart = validEntry.fetchStart,
    redirectStart = validEntry.redirectStart,
    redirectEnd = validEntry.redirectEnd,
    domainLookupStart = validEntry.domainLookupStart,
    domainLookupEnd = validEntry.domainLookupEnd,
    connectStart = validEntry.connectStart,
    secureConnectionStart = validEntry.secureConnectionStart,
    connectEnd = validEntry.connectEnd,
    requestStart = validEntry.requestStart,
    responseStart = validEntry.responseStart,
    responseEnd = validEntry.responseEnd
  var details = {
    firstbyte: formatTiming(startTime, domainLookupStart, responseStart),
    trans: formatTiming(startTime, responseStart, responseEnd),
    ttfb: formatTiming(startTime, requestStart, responseStart)
  }
  // Make sure a connection occurred
  if (connectEnd !== fetchStart) {
    details.tcp = formatTiming(startTime, connectStart, connectEnd)

    // Make sure a secure connection occurred
    if (areInOrder(connectStart, secureConnectionStart, connectEnd)) {
      details.ssl = formatTiming(startTime, secureConnectionStart, connectEnd)
    }
  }

  // Make sure a domain lookup occurred
  if (domainLookupEnd !== fetchStart) {
    details.dns = formatTiming(startTime, domainLookupStart, domainLookupEnd)
  }

  if (hasRedirection(entry)) {
    details.redirect = formatTiming(startTime, redirectStart, redirectEnd)
  }

  return details
}

export function toValidEntry(entry) {
  // Ensure timings are in the right order. On top of filtering out potential invalid
  // RumPerformanceResourceTiming, it will ignore entries from requests where timings cannot be
  // collected, for example cross origin requests without a "Timing-Allow-Origin" header allowing
  // it.
  // page_fmp	float		????????????(?????????????????????????????????????????????????????????)??????FCP??????????????????????????????????????????FCP???????????????????????????	firstPaintContentEnd - firstPaintContentStart
  // page_fpt	float		????????????????????????????????????(????????????????????????????????????????????????HTML???????????????????????????)	responseEnd - fetchStart
  // page_tti	float		?????????????????????(?????????????????????HTML??????????????????DOM?????????????????????????????????????????????)	domInteractive - fetchStart
  // page_firstbyte	float		????????????	responseStart - domainLookupStart
  // page_dom_ready	float		DOM Ready??????(??????????????????????????????JS????????????JS????????????=ready-tti???)	domContentLoadEventEnd - fetchStart
  // page_load	float		????????????????????????(load=??????????????????+DOM????????????+??????JS??????+?????????????????????)	loadEventStart - fetchStart
  // page_dns	float		dns????????????	domainLookupEnd - domainLookupStart
  // page_tcp	float		tcp????????????	connectEnd - connectStart
  // page_ssl	float		ssl??????????????????(????????????https)	connectEnd - secureConnectionStart
  // page_ttfb	float		??????????????????	responseStart - requestStart
  // page_trans	float		??????????????????	responseEnd - responseStart
  // page_dom	float		DOM????????????	domInteractive - responseEnd
  // page_resource_load_time	float		??????????????????	loadEventStart - domContentLoadedEventEnd
  if (
    !areInOrder(
      entry.startTime,
      entry.fetchStart,
      entry.domainLookupStart,
      entry.domainLookupEnd,
      entry.connectStart,
      entry.connectEnd,
      entry.requestStart,
      entry.responseStart,
      entry.responseEnd
    )
  ) {
    return undefined
  }

  if (!hasRedirection(entry)) {
    return entry
  }

  var redirectStart = entry.redirectStart
  var redirectEnd = entry.redirectEnd
  // Firefox doesn't provide redirect timings on cross origin requests.
  // Provide a default for those.
  if (redirectStart < entry.startTime) {
    redirectStart = entry.startTime
  }
  if (redirectEnd < entry.startTime) {
    redirectEnd = entry.fetchStart
  }

  // Make sure redirect timings are in order
  if (
    !areInOrder(entry.startTime, redirectStart, redirectEnd, entry.fetchStart)
  ) {
    return undefined
  }
  return extend({}, entry, {
    redirectEnd: redirectEnd,
    redirectStart: redirectStart
  })
  // return {
  //   ...entry,
  //   redirectEnd,
  //   redirectStart
  // }
}

function hasRedirection(entry) {
  // The only time fetchStart is different than startTime is if a redirection occurred.
  return entry.fetchStart !== entry.startTime
}

function formatTiming(origin, start, end) {
  return msToNs(end - start)
  // return {
  //   duration: msToNs(end - start),
  //   start: msToNs(start - origin)
  // }
}

export function computeSize(entry) {
  // Make sure a request actually occurred
  if (entry.startTime < entry.responseStart) {
    return entry.decodedBodySize
  }
  return undefined
}

export function isAllowedRequestUrl(configuration, url) {
  return url && !isIntakeRequest(url, configuration)
}
