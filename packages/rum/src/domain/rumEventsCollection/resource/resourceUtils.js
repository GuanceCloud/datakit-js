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
//  interface PerformanceResourceDetails {
//   redirect?: PerformanceResourceDetailsElement
//   dns?: PerformanceResourceDetailsElement
//   connect?: PerformanceResourceDetailsElement
//   ssl?: PerformanceResourceDetailsElement
//   firstByte: PerformanceResourceDetailsElement
//   download: PerformanceResourceDetailsElement
//   fmp:
// }
// page_fmp	float		首屏时间(用于衡量用户什么时候看到页面的主要内容)，跟FCP的时长非常接近，这里我们就用FCP的时间作为首屏时间	firstPaintContentEnd - firstPaintContentStart
// page_fpt	float		首次渲染时间，即白屏时间(从请求开始到浏览器开始解析第一批HTML文档字节的时间差。)	responseEnd - fetchStart
// page_tti	float		首次可交互时间(浏览器完成所有HTML解析并且完成DOM构建，此时浏览器开始加载资源。)	domInteractive - fetchStart
// page_firstbyte	float		首包时间	responseStart - domainLookupStart
// page_dom_ready	float		DOM Ready时间(如果页面有同步执行的JS，则同步JS执行时间=ready-tti。)	domContentLoadEventEnd - fetchStart
// page_load	float		页面完全加载时间(load=首次渲染时间+DOM解析耗时+同步JS执行+资源加载耗时。)	loadEventStart - fetchStart
// page_dns	float		dns解析时间	domainLookupEnd - domainLookupStart
// page_tcp	float		tcp连接时间	connectEnd - connectStart
// page_ssl	float		ssl安全连接时间(仅适用于https)	connectEnd - secureConnectionStart
// page_ttfb	float		请求响应耗时	responseStart - requestStart
// page_trans	float		内容传输时间	responseEnd - responseStart
// page_dom	float		DOM解析耗时	domInteractive - responseEnd
// page_resource_load_time	float		资源加载时间	loadEventStart - domContentLoadedEventEnd

//  navigationStart：当前浏览器窗口的前一个网页关闭，发生unload事件时的Unix毫秒时间戳。如果没有前一个网页，则等于fetchStart属性。

// ·   unloadEventStart：如果前一个网页与当前网页属于同一个域名，则返回前一个网页的unload事件发生时的Unix毫秒时间戳。如果没有前一个网页，或者之前的网页跳转不是在同一个域名内，则返回值为0。

// ·   unloadEventEnd：如果前一个网页与当前网页属于同一个域名，则返回前一个网页unload事件的回调函数结束时的Unix毫秒时间戳。如果没有前一个网页，或者之前的网页跳转不是在同一个域名内，则返回值为0。

// ·   redirectStart：返回第一个HTTP跳转开始时的Unix毫秒时间戳。如果没有跳转，或者不是同一个域名内部的跳转，则返回值为0。

// ·   redirectEnd：返回最后一个HTTP跳转结束时（即跳转回应的最后一个字节接受完成时）的Unix毫秒时间戳。如果没有跳转，或者不是同一个域名内部的跳转，则返回值为0。

// ·   fetchStart：返回浏览器准备使用HTTP请求读取文档时的Unix毫秒时间戳。该事件在网页查询本地缓存之前发生。

// ·   domainLookupStart：返回域名查询开始时的Unix毫秒时间戳。如果使用持久连接，或者信息是从本地缓存获取的，则返回值等同于fetchStart属性的值。

// ·   domainLookupEnd：返回域名查询结束时的Unix毫秒时间戳。如果使用持久连接，或者信息是从本地缓存获取的，则返回值等同于fetchStart属性的值。

// ·   connectStart：返回HTTP请求开始向服务器发送时的Unix毫秒时间戳。如果使用持久连接（persistent connection），则返回值等同于fetchStart属性的值。

// ·   connectEnd：返回浏览器与服务器之间的连接建立时的Unix毫秒时间戳。如果建立的是持久连接，则返回值等同于fetchStart属性的值。连接建立指的是所有握手和认证过程全部结束。

// ·   secureConnectionStart：返回浏览器与服务器开始安全链接的握手时的Unix毫秒时间戳。如果当前网页不要求安全连接，则返回0。

// ·   requestStart：返回浏览器向服务器发出HTTP请求时（或开始读取本地缓存时）的Unix毫秒时间戳。

// ·   responseStart：返回浏览器从服务器收到（或从本地缓存读取）第一个字节时的Unix毫秒时间戳。

// ·   responseEnd：返回浏览器从服务器收到（或从本地缓存读取）最后一个字节时（如果在此之前HTTP连接已经关闭，则返回关闭时）的Unix毫秒时间戳。

// ·   domLoading：返回当前网页DOM结构开始解析时（即Document.readyState属性变为“loading”、相应的readystatechange事件触发时）的Unix毫秒时间戳。

// ·   domInteractive：返回当前网页DOM结构结束解析、开始加载内嵌资源时（即Document.readyState属性变为“interactive”、相应的readystatechange事件触发时）的Unix毫秒时间戳。

// ·   domContentLoadedEventStart：返回当前网页DOMContentLoaded事件发生时（即DOM结构解析完毕、所有脚本开始运行时）的Unix毫秒时间戳。

// ·   domContentLoadedEventEnd：返回当前网页所有需要执行的脚本执行完成时的Unix毫秒时间戳。

// ·   domComplete：返回当前网页DOM结构生成时（即Document.readyState属性变为“complete”，以及相应的readystatechange事件发生时）的Unix毫秒时间戳。

// ·   loadEventStart：返回当前网页load事件的回调函数开始时的Unix毫秒时间戳。如果该事件还没有发生，返回0。

// ·   loadEventEnd：返回当前网页load事件的回调函数运行结束时的Unix毫秒时间戳。如果该事件还没有发生，返回0
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
