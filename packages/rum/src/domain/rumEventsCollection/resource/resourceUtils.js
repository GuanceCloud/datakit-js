import {
  includes,
  msToNs,
  each,
  toArray,
  getPathName,
  isValidUrl,
  isIntakeRequest,
  ResourceType,
  preferredNow
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

export function computeResourceEntryType(entry) {
  var url = entry.name
  if (!isValidUrl(url)) {
    return ResourceType.OTHER
  }
  var path = getPathName(url)
  var type = ResourceType.OTHER
  each(RESOURCE_TYPES, function (res) {
    var _type = res[0],
      isType = res[1]

    if (isType(entry.initiatorType, path)) {
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
/**
 * Handles the 'deliveryType' property to distinguish between supported values ('cache', 'navigational-prefetch'),
 * undefined (unsupported in some browsers), and other cases ('other' for unknown or unrecognized values).
 * see: https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/deliveryType
 */
export function computeResourceEntryDeliveryType(entry) {
  return entry.deliveryType === '' ? 'other' : entry.deliveryType
}
/**
 * The 'nextHopProtocol' is an empty string for cross-origin resources without CORS headers,
 * meaning the protocol is unknown, and we shouldn't report it.
 * https://developer.mozilla.org/en-US/docs/Web/API/PerformanceResourceTiming/nextHopProtocol#cross-origin_resources
 */
export function computeResourceEntryProtocol(entry) {
  return entry.nextHopProtocol === '' ? undefined : entry.nextHopProtocol
}

export function isResourceEntryRequestType(entry) {
  return (
    entry.initiatorType === 'xmlhttprequest' || entry.initiatorType === 'fetch'
  )
}
var HAS_MULTI_BYTES_CHARACTERS = /[^\u0000-\u007F]/
export function getStrSize(candidate) {
  if (!HAS_MULTI_BYTES_CHARACTERS.test(candidate)) {
    return candidate.length
  }

  if (window.TextEncoder !== undefined) {
    return new TextEncoder().encode(candidate).length
  }

  return new Blob([candidate]).size
}
export function isResourceUrlLimit(name, limitSize) {
  return getStrSize(name) > limitSize
}
export function computeResourceEntryDuration(entry) {
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

export function computePerformanceResourceDetails(entry) {
  if (!hasValidResourceEntryTimings(entry)) {
    return undefined
  }

  var startTime = entry.startTime,
    fetchStart = entry.fetchStart,
    redirectStart = entry.redirectStart,
    redirectEnd = entry.redirectEnd,
    domainLookupStart = entry.domainLookupStart,
    domainLookupEnd = entry.domainLookupEnd,
    connectStart = entry.connectStart,
    secureConnectionStart = entry.secureConnectionStart,
    connectEnd = entry.connectEnd,
    requestStart = entry.requestStart,
    responseStart = entry.responseStart,
    responseEnd = entry.responseEnd
  var details = {
    firstbyte: msToNs(responseStart - requestStart),
    trans: msToNs(responseEnd - responseStart),
    downloadTime: formatTiming(startTime, responseStart, responseEnd),
    firstByteTime: formatTiming(startTime, requestStart, responseStart)
  }
  if (responseStart > 0 && responseStart <= preferredNow()) {
    details.ttfb = msToNs(responseStart - requestStart)
  }
  // Make sure a connection occurred
  if (connectEnd !== fetchStart) {
    details.tcp = msToNs(connectEnd - connectStart)
    details.connectTime = formatTiming(startTime, connectStart, connectEnd)
    // Make sure a secure connection occurred
    if (areInOrder(connectStart, secureConnectionStart, connectEnd)) {
      details.ssl = msToNs(connectEnd - secureConnectionStart)
      details.sslTime = formatTiming(
        startTime,
        secureConnectionStart,
        connectEnd
      )
    }
  }

  // Make sure a domain lookup occurred
  if (domainLookupEnd !== fetchStart) {
    details.dns = msToNs(domainLookupEnd - domainLookupStart)
    details.dnsTime = formatTiming(
      startTime,
      domainLookupStart,
      domainLookupEnd
    )
  }

  if (hasRedirection(entry)) {
    details.redirect = msToNs(redirectEnd - redirectStart)
    details.redirectTime = formatTiming(startTime, redirectStart, redirectEnd)
  }
  // renderBlockstatus
  if (entry.renderBlockingStatus) {
    details.renderBlockingStatus = entry.renderBlockingStatus
  }
  return details
}
export function hasValidResourceEntryDuration(entry) {
  return entry.duration >= 0
}
export function hasValidResourceEntryTimings(entry) {
  var areCommonTimingsInOrder = areInOrder(
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
  var areRedirectionTimingsInOrder = hasRedirection(entry)
    ? areInOrder(
        entry.startTime,
        entry.redirectStart,
        entry.redirectEnd,
        entry.fetchStart
      )
    : true
  return areCommonTimingsInOrder && areRedirectionTimingsInOrder
}

function hasRedirection(entry) {
  return entry.redirectEnd > entry.startTime
}

function formatTiming(origin, start, end) {
  return {
    duration: msToNs(end - start),
    start: msToNs(start - origin)
  }
}

export function computeResourceEntrySize(entry) {
  // Make sure a request actually occurred
  if (entry.startTime < entry.responseStart) {
    return {
      size: entry.decodedBodySize,
      encodedBodySize: entry.encodedBodySize,
      decodedBodySize: entry.decodedBodySize,
      transferSize: entry.transferSize
    }
    // return {
    //   size: entry.decodedBodySize,
    //   encodeSize:
    //     Number.MAX_SAFE_INTEGER < entry.encodedBodySize
    //       ? 0
    //       : entry.encodedBodySize // max safe interger
    // }
  }
  return {
    size: undefined,
    encodedBodySize: undefined,
    decodedBodySize: undefined,
    transferSize: undefined
  }
}

export function isAllowedRequestUrl(configuration, url) {
  return url && !isIntakeRequest(url, configuration)
}

var DATA_URL_REGEX = /data:(.+)?(;base64)?,/g
export var MAX_ATTRIBUTE_VALUE_CHAR_LENGTH = 24_000
export function isLongDataUrl(url) {
  if (url.length <= MAX_ATTRIBUTE_VALUE_CHAR_LENGTH) {
    return false
  } else if (url.substring(0, 5) === 'data:') {
    // Avoid String.match RangeError: Maximum call stack size exceeded
    url = url.substring(0, MAX_ATTRIBUTE_VALUE_CHAR_LENGTH)
    return true
  }
  return false
}

export function sanitizeDataUrl(url) {
  return url.match(DATA_URL_REGEX)[0] + '[...]'
}
