import { DOM_EVENT } from './enums'
var ArrayProto = Array.prototype
var FuncProto = Function.prototype
var ObjProto = Object.prototype
var slice = ArrayProto.slice
var toString = ObjProto.toString
var hasOwnProperty = ObjProto.hasOwnProperty
var nativeBind = FuncProto.bind
var nativeForEach = ArrayProto.forEach
var nativeIndexOf = ArrayProto.indexOf
var nativeIsArray = Array.isArray
var breaker = false
export var each = function (obj, iterator, context) {
  if (obj === null) return false
  if (nativeForEach && obj.forEach === nativeForEach) {
    obj.forEach(iterator, context)
  } else if (obj.length === +obj.length) {
    for (var i = 0, l = obj.length; i < l; i++) {
      if (i in obj && iterator.call(context, obj[i], i, obj) === breaker) {
        return false
      }
    }
  } else {
    for (var key in obj) {
      if (hasOwnProperty.call(obj, key)) {
        if (iterator.call(context, obj[key], key, obj) === breaker) {
          return false
        }
      }
    }
  }
}
export function assign(target) {
  each(slice.call(arguments, 1), function (source) {
    for (var prop in source) {
      if (Object.prototype.hasOwnProperty.call(source, prop)) {
        target[prop] = source[prop]
      }
    }
  })
  return target
}

export function shallowClone(object) {
  return assign({}, object)
}
export var extend = function (obj) {
  each(slice.call(arguments, 1), function (source) {
    for (var prop in source) {
      if (source[prop] !== void 0) {
        obj[prop] = source[prop]
      }
    }
  })
  return obj
}
export var extend2Lev = function (obj) {
  each(slice.call(arguments, 1), function (source) {
    for (var prop in source) {
      if (source[prop] !== void 0) {
        if (isObject(source[prop]) && isObject(obj[prop])) {
          extend(obj[prop], source[prop])
        } else {
          obj[prop] = source[prop]
        }
      }
    }
  })
  return obj
}
export var coverExtend = function (obj) {
  each(slice.call(arguments, 1), function (source) {
    for (var prop in source) {
      if (source[prop] !== void 0 && obj[prop] === void 0) {
        obj[prop] = source[prop]
      }
    }
  })
  return obj
}
export var isArray =
  nativeIsArray ||
  function (obj) {
    return toString.call(obj) === '[object Array]'
  }
export var isFunction = function (f) {
  if (!f) {
    return false
  }
  try {
    return /^\s*\bfunction\b/.test(f)
  } catch (err) {
    return false
  }
}
export var isArguments = function (obj) {
  return !!(obj && hasOwnProperty.call(obj, 'callee'))
}
export var toArray = function (iterable) {
  if (!iterable) return []
  if (iterable.toArray) {
    return iterable.toArray()
  }
  if (isArray(iterable)) {
    return slice.call(iterable)
  }
  if (isArguments(iterable)) {
    return slice.call(iterable)
  }
  return values(iterable)
}
export var values = function (obj) {
  var results = []
  if (obj === null) {
    return results
  }
  each(obj, function (value) {
    results[results.length] = value
  })
  return results
}
export var keys = function (obj) {
  var results = []
  if (obj === null) {
    return results
  }
  each(obj, function (value, key) {
    results[results.length] = key
  })
  return results
}
export var indexOf = function (arr, target) {
  var indexOf = arr.indexOf
  if (indexOf) {
    return indexOf.call(arr, target)
  } else {
    for (var i = 0; i < arr.length; i++) {
      if (target === arr[i]) {
        return i
      }
    }
    return -1
  }
}
export var hasAttribute = function (ele, attr) {
  if (ele.hasAttribute) {
    return ele.hasAttribute(attr)
  } else {
    return !!(ele.attributes[attr] && ele.attributes[attr].specified)
  }
}
export var filter = function (arr, fn, self) {
  if (arr.filter) {
    return arr.filter(fn)
  }
  var ret = []
  for (var i = 0; i < arr.length; i++) {
    if (!hasOwnProperty.call(arr, i)) {
      continue
    }
    var val = arr[i]
    if (fn.call(self, val, i, arr)) {
      ret.push(val)
    }
  }
  return ret
}
export var map = function (arr, fn, self) {
  if (arr.map) {
    return arr.map(fn)
  }
  var ret = []
  for (var i = 0; i < arr.length; i++) {
    if (!hasOwnProperty.call(arr, i)) {
      continue
    }
    var val = arr[i]
    ret.push(fn.call(self, val, i, arr))
  }
  return ret
}
export var some = function (arr, fn, self) {
  if (arr.some) {
    return arr.some(fn)
  }
  var flag = false
  for (var i = 0; i < arr.length; i++) {
    if (!hasOwnProperty.call(arr, i)) {
      continue
    }
    var val = arr[i]
    if (fn.call(self, val, i, arr)) {
      flag = true
      break
    }
  }
  return flag
}
export var every = function (arr, fn, self) {
  if (arr.every) {
    return arr.every(fn)
  }
  var flag = true
  for (var i = 0; i < arr.length; i++) {
    if (!hasOwnProperty.call(arr, i)) {
      continue
    }
    var val = arr[i]
    if (!fn.call(self, val, i, arr)) {
      flag = false
      break
    }
  }
  return flag
}
export var matchList = function (list, value) {
  return some(list, function (item) {
    return item === value || (item instanceof RegExp && item.test(value))
  })
}
// https://github.com/jquery/jquery/blob/a684e6ba836f7c553968d7d026ed7941e1a612d8/src/selector/escapeSelector.js
export var cssEscape = function (str) {
  if (window.CSS && window.CSS.escape) {
    return window.CSS.escape(str)
  }

  // eslint-disable-next-line no-control-regex
  return str.replace(
    /([\0-\x1f\x7f]|^-?\d)|^-$|[^\x80-\uFFFF\w-]/g,
    function (ch, asCodePoint) {
      if (asCodePoint) {
        // U+0000 NULL becomes U+FFFD REPLACEMENT CHARACTER
        if (ch === '\0') {
          return '\uFFFD'
        }
        // Control characters and (dependent upon position) numbers get escaped as code points
        return (
          ch.slice(0, -1) +
          '\\' +
          ch.charCodeAt(ch.length - 1).toString(16) +
          ' '
        )
      }
      // Other potentially-special ASCII characters get backslash-escaped
      return '\\' + ch
    }
  )
}
export var inherit = function (subclass, superclass) {
  var F = function () {}
  F.prototype = superclass.prototype
  subclass.prototype = new F()
  subclass.prototype.constructor = subclass
  subclass.superclass = superclass.prototype
  return subclass
}
export var tirm = function (str) {
  return str.replace(/^[\s\uFEFF\xA0]+|[\s\uFEFF\xA0]+$/g, '')
}
export var isObject = function (obj) {
  if (obj === null) return false
  return toString.call(obj) === '[object Object]'
}

export var isEmptyObject = function (obj) {
  if (isObject(obj)) {
    for (var key in obj) {
      if (hasOwnProperty.call(obj, key)) {
        return false
      }
    }
    return true
  } else {
    return false
  }
}
export var objectEntries = function (object) {
  var res = []
  each(object, function (value, key) {
    res.push([key, value])
  })
  return res
}
export var isUndefined = function (obj) {
  return obj === void 0
}
export var isString = function (obj) {
  return toString.call(obj) === '[object String]'
}
export var isDate = function (obj) {
  return toString.call(obj) === '[object Date]'
}
export var isBoolean = function (obj) {
  return toString.call(obj) === '[object Boolean]'
}
export var isNumber = function (obj) {
  return toString.call(obj) === '[object Number]' && /[\d\.]+/.test(String(obj))
}
export var isElement = function (obj) {
  return !!(obj && obj.nodeType === 1)
}
export var isJSONString = function (str) {
  try {
    JSON.parse(str)
  } catch (e) {
    return false
  }
  return true
}
export var safeJSONParse = function (str) {
  var val = null
  try {
    val = JSON.parse(str)
  } catch (e) {
    return false
  }
  return val
}
export var decodeURIComponent = function (val) {
  var result = val
  try {
    result = decodeURIComponent(val)
  } catch (error) {
    result = val
  }
  return result
}
export var encodeDates = function (obj) {
  each(obj, function (v, k) {
    if (isDate(v)) {
      obj[k] = formatDate(v)
    } else if (isObject(v)) {
      obj[k] = encodeDates(v)
    }
  })
  return obj
}
export var mediaQueriesSupported = function () {
  return (
    typeof window.matchMedia !== 'undefined' ||
    typeof window.msMatchMedia !== 'undefined'
  )
}
export var getScreenOrientation = function () {
  var screenOrientationAPI =
    screen.msOrientation ||
    screen.mozOrientation ||
    (screen.orientation || {}).type
  var screenOrientation = '未取到值'
  if (screenOrientationAPI) {
    screenOrientation =
      screenOrientationAPI.indexOf('landscape') > -1 ? 'landscape' : 'portrait'
  } else if (mediaQueriesSupported()) {
    var matchMediaFunc = window.matchMedia || window.msMatchMedia
    if (matchMediaFunc('(orientation: landscape)').matches) {
      screenOrientation = 'landscape'
    } else if (matchMediaFunc('(orientation: portrait)').matches) {
      screenOrientation = 'portrait'
    }
  }
  return screenOrientation
}
export var now =
  Date.now ||
  function () {
    return new Date().getTime()
  }

export var throttle = function (func, wait, options) {
  var timeout, context, args, result
  var previous = 0
  if (!options) options = {}

  var later = function () {
    previous = options.leading === false ? 0 : new Date().getTime()
    timeout = null
    result = func.apply(context, args)
    if (!timeout) context = args = null
  }

  var throttled = function () {
    args = arguments
    var now = new Date().getTime()
    if (!previous && options.leading === false) previous = now
    //下次触发 func 剩余的时间
    var remaining = wait - (now - previous)
    context = this
    // 如果没有剩余的时间了或者你改了系统时间
    if (remaining <= 0 || remaining > wait) {
      if (timeout) {
        clearTimeout(timeout)
        timeout = null
      }
      previous = now
      result = func.apply(context, args)
      if (!timeout) context = args = null
    } else if (!timeout && options.trailing !== false) {
      timeout = setTimeout(later, remaining)
    }
    return result
  }
  throttled.cancel = function () {
    clearTimeout(timeout)
    previous = 0
    timeout = null
  }
  return throttled
}
export var hashCode = function (str) {
  if (typeof str !== 'string') {
    return 0
  }
  var hash = 0
  var char = null
  if (str.length == 0) {
    return hash
  }
  for (var i = 0; i < str.length; i++) {
    char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash
  }
  return hash
}
export var formatDate = function (d) {
  function pad(n) {
    return n < 10 ? '0' + n : n
  }

  return (
    d.getFullYear() +
    '-' +
    pad(d.getMonth() + 1) +
    '-' +
    pad(d.getDate()) +
    ' ' +
    pad(d.getHours()) +
    ':' +
    pad(d.getMinutes()) +
    ':' +
    pad(d.getSeconds()) +
    '.' +
    pad(d.getMilliseconds())
  )
}
export var searchObjDate = function (o) {
  if (isObject(o)) {
    each(o, function (a, b) {
      if (isObject(a)) {
        searchObjDate(o[b])
      } else {
        if (isDate(a)) {
          o[b] = formatDate(a)
        }
      }
    })
  }
}
export var formatJsonString = function (obj) {
  try {
    return JSON.stringify(obj, null, '  ')
  } catch (e) {
    return JSON.stringify(obj)
  }
}
// export var formatString = function (str) {
//   if (str.length > MAX_STRING_LENGTH) {
//     sd.log('字符串长度超过限制，已经做截取--' + str)
//     return str.slice(0, MAX_STRING_LENGTH)
//   } else {
//     return str
//   }
// }
export var searchObjString = function (o) {
  if (isObject(o)) {
    each(o, function (a, b) {
      if (isObject(a)) {
        searchObjString(o[b])
      } else {
        if (isString(a)) {
          o[b] = formatString(a)
        }
      }
    })
  }
}
export var unique = function (ar) {
  var temp,
    n = [],
    o = {}
  for (var i = 0; i < ar.length; i++) {
    temp = ar[i]
    if (!(temp in o)) {
      o[temp] = true
      n.push(temp)
    }
  }
  return n
}
export var strip_empty_properties = function (p) {
  var ret = {}
  each(p, function (v, k) {
    if (v != null) {
      ret[k] = v
    }
  })
  return ret
}
export var utf8Encode = function (string) {
  string = (string + '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')

  var utftext = '',
    start,
    end
  var stringl = 0,
    n

  start = end = 0
  stringl = string.length

  for (n = 0; n < stringl; n++) {
    var c1 = string.charCodeAt(n)
    var enc = null

    if (c1 < 128) {
      end++
    } else if (c1 > 127 && c1 < 2048) {
      enc = String.fromCharCode((c1 >> 6) | 192, (c1 & 63) | 128)
    } else {
      enc = String.fromCharCode(
        (c1 >> 12) | 224,
        ((c1 >> 6) & 63) | 128,
        (c1 & 63) | 128
      )
    }
    if (enc !== null) {
      if (end > start) {
        utftext += string.substring(start, end)
      }
      utftext += enc
      start = end = n + 1
    }
  }

  if (end > start) {
    utftext += string.substring(start, string.length)
  }

  return utftext
}
export var base64Encode = function (data) {
  if (typeof btoa === 'function') {
    return btoa(
      encodeURIComponent(data).replace(/%([0-9A-F]{2})/g, function (match, p1) {
        return String.fromCharCode('0x' + p1)
      })
    )
  }
  data = String(data)
  var b64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
  var o1,
    o2,
    o3,
    h1,
    h2,
    h3,
    h4,
    bits,
    i = 0,
    ac = 0,
    enc = '',
    tmp_arr = []
  if (!data) {
    return data
  }
  data = utf8Encode(data)
  do {
    o1 = data.charCodeAt(i++)
    o2 = data.charCodeAt(i++)
    o3 = data.charCodeAt(i++)

    bits = (o1 << 16) | (o2 << 8) | o3

    h1 = (bits >> 18) & 0x3f
    h2 = (bits >> 12) & 0x3f
    h3 = (bits >> 6) & 0x3f
    h4 = bits & 0x3f
    tmp_arr[ac++] =
      b64.charAt(h1) + b64.charAt(h2) + b64.charAt(h3) + b64.charAt(h4)
  } while (i < data.length)

  enc = tmp_arr.join('')

  switch (data.length % 3) {
    case 1:
      enc = enc.slice(0, -2) + '=='
      break
    case 2:
      enc = enc.slice(0, -1) + '='
      break
  }

  return enc
}
/**
 * UUID v4
 * from https://gist.github.com/jed/982883
 */
export function UUID(placeholder) {
  return placeholder
    ? // eslint-disable-next-line  no-bitwise
      (
        parseInt(placeholder, 10) ^
        ((Math.random() * 16) >> (parseInt(placeholder, 10) / 4))
      ).toString(16)
    : `${1e7}-${1e3}-${4e3}-${8e3}-${1e11}`.replace(/[018]/g, UUID)
}

// 替换url包含数字的路由
export function replaceNumberCharByPath(path) {
  var pathGroup = ''
  if (path) {
    pathGroup = path.replace(/\/([^\/]*)\d([^\/]*)/g, '/?').replace(/\/$/g, '')
  }
  return pathGroup || '/'
}
export var getQueryParam = function (url, param) {
  param = param.replace(/[\[]/, '\\[').replace(/[\]]/, '\\]')
  url = decodeURIComponent(url)
  var regexS = '[\\?&]' + param + '=([^&#]*)',
    regex = new RegExp(regexS),
    results = regex.exec(url)
  if (
    results === null ||
    (results && typeof results[1] !== 'string' && results[1].length)
  ) {
    return ''
  } else {
    return decodeURIComponent(results[1])
  }
}
export var urlParse = function (para) {
  var URLParser = function (a) {
    this._fields = {
      Username: 4,
      Password: 5,
      Port: 7,
      Protocol: 2,
      Host: 6,
      Path: 8,
      URL: 0,
      QueryString: 9,
      Fragment: 10
    }
    this._values = {}
    this._regex = null
    this._regex =
      /^((\w+):\/\/)?((\w+):?(\w+)?@)?([^\/\?:]+):?(\d+)?(\/?[^\?#]+)?\??([^#]+)?#?(\w*)/

    if (typeof a != 'undefined') {
      this._parse(a)
    }
  }
  URLParser.prototype.setUrl = function (a) {
    this._parse(a)
  }
  URLParser.prototype._initValues = function () {
    for (var a in this._fields) {
      this._values[a] = ''
    }
  }
  URLParser.prototype.addQueryString = function (queryObj) {
    if (typeof queryObj !== 'object') {
      return false
    }
    var query = this._values.QueryString || ''
    for (var i in queryObj) {
      if (new RegExp(i + '[^&]+').test(query)) {
        query = query.replace(new RegExp(i + '[^&]+'), i + '=' + queryObj[i])
      } else {
        if (query.slice(-1) === '&') {
          query = query + i + '=' + queryObj[i]
        } else {
          if (query === '') {
            query = i + '=' + queryObj[i]
          } else {
            query = query + '&' + i + '=' + queryObj[i]
          }
        }
      }
    }
    this._values.QueryString = query
  }
  URLParser.prototype.getParse = function () {
    return this._values
  }
  URLParser.prototype.getUrl = function () {
    var url = ''
    url += this._values.Origin
    // url += this._values.Port ? ':' + this._values.Port : ''
    url += this._values.Path
    url += this._values.QueryString ? '?' + this._values.QueryString : ''
    return url
  }
  URLParser.prototype._parse = function (a) {
    this._initValues()
    var b = this._regex.exec(a)
    if (!b) {
      throw 'DPURLParser::_parse -> Invalid URL'
    }
    for (var c in this._fields) {
      if (typeof b[this._fields[c]] != 'undefined') {
        this._values[c] = b[this._fields[c]]
      }
    }
    this._values['Path'] = this._values['Path'] || '/'
    this._values['Hostname'] = this._values['Host'].replace(/:\d+$/, '')
    this._values['Origin'] =
      this._values['Protocol'] +
      '://' +
      this._values['Hostname'] +
      (this._values.Port ? ':' + this._values.Port : '')
    // this._values['Hostname'] = this._values['Host'].replace(/:\d+$/, '')
    // this._values['Origin'] =
    //   this._values['Protocol'] + '://' + this._values['Hostname']
  }
  return new URLParser(para)
}
export function elementMatches(element, selector) {
  if (element.matches) {
    return element.matches(selector)
  }
  // IE11 support
  if (element.msMatchesSelector) {
    return element.msMatchesSelector(selector)
  }
  return false
}
export var addEvent = function () {
  function fixEvent(event) {
    if (event) {
      event.preventDefault = fixEvent.preventDefault
      event.stopPropagation = fixEvent.stopPropagation
      event._getPath = fixEvent._getPath
    }
    return event
  }
  fixEvent._getPath = function () {
    var ev = this
    var polyfill = function () {
      try {
        var element = ev.target
        var pathArr = [element]
        if (element === null || element.parentElement === null) {
          return []
        }
        while (element.parentElement !== null) {
          element = element.parentElement
          pathArr.unshift(element)
        }
        return pathArr
      } catch (error) {
        return []
      }
    }
    return (
      this.path || (this.composedPath() && this.composedPath()) || polyfill()
    )
  }
  fixEvent.preventDefault = function () {
    this.returnValue = false
  }
  fixEvent.stopPropagation = function () {
    this.cancelBubble = true
  }
  var register_event = function (element, type, handle) {
    if (element && element.addEventListener) {
      element.addEventListener(
        type,
        function (e) {
          e._getPath = fixEvent._getPath
          handler.call(this, e)
        },
        false
      )
    } else {
      var ontype = 'on' + type
      var old_handler = element[ontype]
      element[ontype] = makeHandler(element, handler, old_handler)
    }
  }
  function makeHandler(element, new_handler, old_handlers) {
    var handler = function (event) {
      event = event || fixEvent(window.event)
      if (!event) {
        return undefined
      }
      event.target = event.srcElement

      var ret = true
      var old_result, new_result
      if (typeof old_handlers === 'function') {
        old_result = old_handlers(event)
      }
      new_result = new_handler.call(element, event)
      if (false === old_result || false === new_result) {
        ret = false
      }
      return ret
    }
    return handler
  }

  register_event.apply(null, arguments)
}
export var addHashEvent = function (callback) {
  var hashEvent = 'pushState' in window.history ? 'popstate' : 'hashchange'
  addEvent(window, hashEvent, callback)
}
export var addSinglePageEvent = function (callback) {
  var current_url = location.href
  var historyPushState = window.history.pushState
  var historyReplaceState = window.history.replaceState

  window.history.pushState = function () {
    historyPushState.apply(window.history, arguments)
    callback(current_url)
    current_url = location.href
  }
  window.history.replaceState = function () {
    historyReplaceState.apply(window.history, arguments)
    callback(current_url)
    current_url = location.href
  }

  var singlePageEvent = historyPushState ? 'popstate' : 'hashchange'
  addEvent(window, singlePageEvent, function () {
    callback(current_url)
    current_url = location.href
  })
}
export var cookie = {
  get: function (name) {
    var nameEQ = name + '='
    var ca = document.cookie.split(';')
    for (var i = 0; i < ca.length; i++) {
      var c = ca[i]
      while (c.charAt(0) == ' ') {
        c = c.substring(1, c.length)
      }
      if (c.indexOf(nameEQ) == 0) {
        return decodeURIComponent(c.substring(nameEQ.length, c.length))
      }
    }
    return null
  },
  set: function (name, value, days, is_secure) {
    var cdomain = '',
      expires = '',
      secure = ''
    days = days == null ? 73000 : days
    if (days !== 0) {
      var date = new Date()
      if (String(days).slice(-1) === 's') {
        date.setTime(date.getTime() + Number(String(days).slice(0, -1)) * 1000)
      } else {
        date.setTime(date.getTime() + days * 24 * 60 * 60 * 1000)
      }

      expires = '; expires=' + date.toGMTString()
    }

    if (is_secure) {
      secure = '; secure'
    }

    document.cookie =
      name +
      '=' +
      encodeURIComponent(value) +
      expires +
      '; path=/' +
      cdomain +
      secure
  },

  remove: function (name) {
    cookie.set(name, '', -1)
  }
}
export var localStorage = {
  get: function (name) {
    return window.localStorage.getItem(name)
  },

  parse: function (name) {
    var storedValue
    try {
      storedValue = JSON.parse(localStorage.get(name)) || null
    } catch (err) {
      sd.log(err)
    }
    return storedValue
  },

  set: function (name, value) {
    window.localStorage.setItem(name, value)
  },

  remove: function (name) {
    window.localStorage.removeItem(name)
  },

  isSupport: function () {
    var supported = true
    try {
      var key = '__sensorsdatasupport__'
      var val = 'testIsSupportStorage'
      localStorage.set(key, val)
      if (localStorage.get(key) !== val) {
        supported = false
      }
      localStorage.remove(key)
    } catch (err) {
      supported = false
    }
    return supported
  }
}
export var sessionStorage = {
  isSupport: function () {
    var supported = true

    var key = '__sensorsdatasupport__'
    var val = 'testIsSupportStorage'
    try {
      if (sessionStorage && sessionStorage.setItem) {
        sessionStorage.setItem(key, val)
        sessionStorage.removeItem(key, val)
        supported = true
      } else {
        supported = false
      }
    } catch (e) {
      supported = false
    }
    return supported
  }
}
export var isSupportCors = function () {
  if (typeof window.XMLHttpRequest === 'undefined') {
    return false
  }
  if ('withCredentials' in new XMLHttpRequest()) {
    return true
  } else if (typeof XDomainRequest !== 'undefined') {
    return true
  } else {
    return false
  }
}
export var xhr = function (cors) {
  if (cors) {
    if (
      typeof window.XMLHttpRequest !== 'undefined' &&
      'withCredentials' in new XMLHttpRequest()
    ) {
      return new XMLHttpRequest()
    } else if (typeof XDomainRequest !== 'undefined') {
      return new XDomainRequest()
    } else {
      return null
    }
  } else {
    if (typeof window.XMLHttpRequest !== 'undefined') {
      return new XMLHttpRequest()
    }
    if (window.ActiveXObject) {
      try {
        return new ActiveXObject('Msxml2.XMLHTTP')
      } catch (d) {
        try {
          return new ActiveXObject('Microsoft.XMLHTTP')
        } catch (d) {
          console.log(d)
        }
      }
    }
  }
}
export var ajax = function (para) {
  para.timeout = para.timeout || 20000

  para.credentials =
    typeof para.credentials === 'undefined' ? true : para.credentials

  function getJSON(data) {
    if (!data) {
      return ''
    }
    try {
      return JSON.parse(data)
    } catch (e) {
      return {}
    }
  }

  var g = xhr(para.cors)

  if (!g) {
    return false
  }

  if (!para.type) {
    para.type = para.data ? 'POST' : 'GET'
  }
  para = extend(
    {
      success: function () {},
      error: function () {}
    },
    para
  )

  try {
    if (typeof g === 'object' && 'timeout' in g) {
      g.timeout = para.timeout
    } else {
      setTimeout(function () {
        g.abort()
      }, para.timeout + 500)
    }
  } catch (e) {
    try {
      setTimeout(function () {
        g.abort()
      }, para.timeout + 500)
    } catch (e2) {}
  }

  g.onreadystatechange = function () {
    try {
      if (g.readyState == 4) {
        if ((g.status >= 200 && g.status < 300) || g.status == 304) {
          para.success(getJSON(g.responseText))
        } else {
          para.error(getJSON(g.responseText), g.status)
        }
        g.onreadystatechange = null
        g.onload = null
      }
    } catch (e) {
      g.onreadystatechange = null
      g.onload = null
    }
  }

  g.open(para.type, para.url, true)

  try {
    if (para.credentials) {
      g.withCredentials = true
    }
    if (isObject(para.header)) {
      for (var i in para.header) {
        g.setRequestHeader(i, para.header[i])
      }
    }

    if (para.data) {
      if (!para.cors) {
        g.setRequestHeader('X-Requested-With', 'XMLHttpRequest')
      }
      if (para.contentType === 'application/json') {
        g.setRequestHeader('Content-type', 'application/json; charset=UTF-8')
      } else {
        g.setRequestHeader('Content-type', 'application/x-www-form-urlencoded')
      }
    }
  } catch (e) {}

  g.send(para.data || null)
}
export var loadScript = function (para) {
  para = extend(
    {
      success: function () {},
      error: function () {},
      appendCall: function (g) {
        document.getElementsByTagName('head')[0].appendChild(g)
      }
    },
    para
  )

  var g = null
  if (para.type === 'css') {
    g = document.createElement('link')
    g.rel = 'stylesheet'
    g.href = para.url
  }
  if (para.type === 'js') {
    g = document.createElement('script')
    g.async = 'async'
    g.setAttribute('charset', 'UTF-8')
    g.src = para.url
    g.type = 'text/javascript'
  }
  g.onload = g.onreadystatechange = function () {
    if (
      !this.readyState ||
      this.readyState === 'loaded' ||
      this.readyState === 'complete'
    ) {
      para.success()
      g.onload = g.onreadystatechange = null
    }
  }
  g.onerror = function () {
    para.error()
    g.onerror = null
  }
  para.appendCall(g)
}
export var getHostname = function (url, defaultValue) {
  if (!defaultValue || typeof defaultValue !== 'string') {
    defaultValue = 'hostname解析异常'
  }
  var hostname = null
  try {
    hostname = URL(url).hostname
  } catch (e) {}
  return hostname || defaultValue
}
export var getQueryParamsFromUrl = function (url) {
  var result = {}
  var arr = url.split('?')
  var queryString = arr[1] || ''
  if (queryString) {
    result = getURLSearchParams('?' + queryString)
  }
  return result
}

export var getURLSearchParams = function (queryString) {
  queryString = queryString || ''
  var decodeParam = function (str) {
    return decodeURIComponent(str)
  }
  var args = {}
  var query = queryString.substring(1)
  var pairs = query.split('&')
  for (var i = 0; i < pairs.length; i++) {
    var pos = pairs[i].indexOf('=')
    if (pos === -1) continue
    var name = pairs[i].substring(0, pos)
    var value = pairs[i].substring(pos + 1)
    name = decodeParam(name)
    value = decodeParam(value)
    args[name] = value
  }
  return args
}
function createCircularReferenceChecker() {
  if (typeof WeakSet !== 'undefined') {
    var set = new WeakSet()
    return {
      hasAlreadyBeenSeen: function (value) {
        var has = set.has(value)
        if (!has) {
          set.add(value)
        }
        return has
      }
    }
  }
  var array = []
  return {
    hasAlreadyBeenSeen: function (value) {
      var has = array.indexOf(value) >= 0
      if (!has) {
        array.push(value)
      }
      return has
    }
  }
}
/**
 * Similar to `typeof`, but distinguish plain objects from `null` and arrays
 */
export function getType(value) {
  if (value === null) {
    return 'null'
  }
  if (Array.isArray(value)) {
    return 'array'
  }
  return typeof value
}
/**
 * Iterate over source and affect its sub values into destination, recursively.
 * If the source and destination can't be merged, return source.
 */
export function mergeInto(destination, source, circularReferenceChecker) {
  // ignore the source if it is undefined
  if (typeof circularReferenceChecker === 'undefined') {
    circularReferenceChecker = createCircularReferenceChecker()
  }
  if (source === undefined) {
    return destination
  }

  if (typeof source !== 'object' || source === null) {
    // primitive values - just return source
    return source
  } else if (source instanceof Date) {
    return new Date(source.getTime())
  } else if (source instanceof RegExp) {
    var flags =
      source.flags ||
      // old browsers compatibility
      [
        source.global ? 'g' : '',
        source.ignoreCase ? 'i' : '',
        source.multiline ? 'm' : '',
        source.sticky ? 'y' : '',
        source.unicode ? 'u' : ''
      ].join('')
    return new RegExp(source.source, flags)
  }

  if (circularReferenceChecker.hasAlreadyBeenSeen(source)) {
    // remove circular references
    return undefined
  } else if (Array.isArray(source)) {
    var merged = Array.isArray(destination) ? destination : []
    for (var i = 0; i < source.length; ++i) {
      merged[i] = mergeInto(merged[i], source[i], circularReferenceChecker)
    }
    return merged
  }

  var merged = getType(destination) === 'object' ? destination : {}
  for (var key in source) {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      merged[key] = mergeInto(
        merged[key],
        source[key],
        circularReferenceChecker
      )
    }
  }
  return merged
}

/**
 * A simplistic implementation of a deep clone algorithm.
 * Caveats:
 * - It doesn't maintain prototype chains - don't use with instances of custom classes.
 * - It doesn't handle Map and Set
 */
export function deepClone(value) {
  return mergeInto(undefined, value)
}
export var _URL = function (url) {
  var result = {}
  var basicProps = [
    'hash',
    'host',
    'hostname',
    'href',
    'origin',
    'password',
    'pathname',
    'port',
    'protocol',
    'search',
    'username'
  ]
  var isURLAPIWorking = function () {
    var url
    try {
      url = new URL('http://modernizr.com/')
      return url.href === 'http://modernizr.com/'
    } catch (e) {
      return false
    }
  }
  if (typeof window.URL === 'function' && isURLAPIWorking()) {
    result = new URL(url)
    if (!result.searchParams) {
      result.searchParams = (function () {
        var params = getURLSearchParams(result.search)
        return {
          get: function (searchParam) {
            return params[searchParam]
          }
        }
      })()
    }
  } else {
    var _regex = /^https?:\/\/.+/
    if (_regex.test(url) === false) {
      throw 'Invalid URL'
    }
    var link = document.createElement('a')
    link.href = url
    for (var i = basicProps.length - 1; i >= 0; i--) {
      var prop = basicProps[i]
      result[prop] = link[prop]
    }
    if (
      result.hostname &&
      typeof result.pathname === 'string' &&
      result.pathname.indexOf('/') !== 0
    ) {
      result.pathname = '/' + result.pathname
    }
    result.searchParams = (function () {
      var params = getURLSearchParams(result.search)
      return {
        get: function (searchParam) {
          return params[searchParam]
        }
      }
    })()
  }
  return result
}

export var getCurrentDomain = function (url) {
  var cookieTopLevelDomain = getCookieTopLevelDomain()
  if (url === '') {
    return 'url解析失败'
  } else if (cookieTopLevelDomain === '') {
    return 'url解析失败'
  } else {
    return cookieTopLevelDomain
  }
}
export var getCookieTopLevelDomain = function (hostname) {
  hostname = hostname || window.location.hostname
  var splitResult = hostname.split('.')
  if (
    isArray(splitResult) &&
    splitResult.length >= 2 &&
    !/^(\d+\.)+\d+$/.test(hostname)
  ) {
    var domainStr = '.' + splitResult.splice(splitResult.length - 1, 1)
    while (splitResult.length > 0) {
      domainStr =
        '.' + splitResult.splice(splitResult.length - 1, 1) + domainStr
      document.cookie = 'domain_test=true; path=/; domain=' + domainStr
      if (document.cookie.indexOf('domain_test=true') !== -1) {
        var now = new Date()
        now.setTime(now.getTime() - 1000)
        document.cookie =
          'domain_test=true; expires=' +
          now.toGMTString() +
          '; path=/; domain=' +
          domainStr
        return domainStr
      }
    }
  }
  return ''
}
export var strToUnicode = function (str) {
  if (typeof str !== 'string') {
    return str
  }
  var nstr = ''
  for (var i = 0; i < str.length; i++) {
    nstr += '\\' + str.charCodeAt(i).toString(16)
  }
  return nstr
}
export var autoExeQueue = function () {
  var queue = {
    items: [],
    enqueue: function (val) {
      this.items.push(val)
      this.start()
    },
    dequeue: function () {
      return this.items.shift()
    },
    getCurrentItem: function () {
      return this.items[0]
    },
    isRun: false,
    start: function () {
      if (this.items.length > 0 && !this.isRun) {
        this.isRun = true
        this.getCurrentItem().start()
      }
    },
    close: function () {
      this.dequeue()
      this.isRun = false
      this.start()
    }
  }
  return queue
}
export var strip_sa_properties = function (p) {
  if (!isObject(p)) {
    return p
  }
  each(p, function (v, k) {
    if (isArray(v)) {
      var temp = []
      each(v, function (arrv) {
        if (isString(arrv)) {
          temp.push(arrv)
        } else {
          console.log(
            '您的数据-',
            k,
            v,
            '的数组里的值必须是字符串,已经将其删除'
          )
        }
      })
      if (temp.length !== 0) {
        p[k] = temp
      } else {
        delete p[k]
        console.log('已经删除空的数组')
      }
    }
    if (
      !(
        isString(v) ||
        isNumber(v) ||
        isDate(v) ||
        isBoolean(v) ||
        isArray(v) ||
        isFunction(v) ||
        k === '$option'
      )
    ) {
      console.log('您的数据-', k, v, '-格式不满足要求，我们已经将其删除')
      delete p[k]
    }
  })
  return p
}

export var searchConfigData = function (data) {
  if (typeof data === 'object' && data.$option) {
    var data_config = data.$option
    delete data.$option
    return data_config
  } else {
    return {}
  }
}
// 从字符串 src 中查找 k+sp 和  e 之间的字符串，如果 k==e 且 k 只有一个，或者 e 不存在，从 k+sp 截取到字符串结束
// abcd=1&b=1&c=3;
// abdc=1;b=1;a=3;
export var stringSplice = function (src, k, e, sp) {
  if (src === '') {
    return ''
  }
  sp = sp === '' ? '=' : sp
  k += sp
  var ps = src.indexOf(k)
  if (ps < 0) {
    return ''
  }
  ps += k.length
  var pe = pe < ps ? src.length : src.indexOf(e, ps)
  return src.substring(ps, pe)
}
export function getStatusGroup(status) {
  if (!status) return status
  return (
    String(status).substr(0, 1) + String(status).substr(1).replace(/\d*/g, 'x')
  )
}
export var getReferrer = function () {
  var ref = document.referrer.toLowerCase()
  var re = /^[^\?&#]*.swf([\?#])?/
  // 如果页面 Referer 为空，从 URL 中获取
  if (ref === '' || ref.match(re)) {
    ref = stringSplice(window.location.href, 'ref', '&', '')
    if (ref !== '') {
      return encodeURIComponent(ref)
    }
  }
  return encodeURIComponent(ref)
}
export var typeDecide = function (o, type) {
  return toString.call(o) === '[object ' + type + ']'
}
export function jsonStringify(value, replacer, space) {
  if (value === null || value === undefined) {
    return JSON.stringify(value)
  }
  var originalToJSON = [false, undefined]
  if (hasToJSON(value)) {
    // We need to add a flag and not rely on the truthiness of value.toJSON
    // because it can be set but undefined and that's actually significant.
    originalToJSON = [true, value.toJSON]
    delete value.toJSON
  }

  var originalProtoToJSON = [false, undefined]
  var prototype
  if (typeof value === 'object') {
    prototype = Object.getPrototypeOf(value)
    if (hasToJSON(prototype)) {
      originalProtoToJSON = [true, prototype.toJSON]
      delete prototype.toJSON
    }
  }

  var result
  try {
    result = JSON.stringify(value, undefined, space)
  } catch (e) {
    result = '<error: unable to serialize object>'
  } finally {
    if (originalToJSON[0]) {
      value.toJSON = originalToJSON[1]
    }
    if (originalProtoToJSON[0]) {
      prototype.toJSON = originalProtoToJSON[1]
    }
  }
  return result
}

function hasToJSON(value) {
  return (
    typeof value === 'object' &&
    value !== null &&
    value.hasOwnProperty('toJSON')
  )
}

export function noop() {}

export var ONE_SECOND = 1000
export var ONE_MINUTE = 60 * ONE_SECOND
export var ONE_HOUR = 60 * ONE_MINUTE
export var ONE_DAY = 24 * ONE_HOUR
export var ONE_YEAR = 365 * ONE_DAY
export var ONE_KIBI_BYTE = 1024
export var ONE_MEBI_BYTE = 1024 * ONE_KIBI_BYTE
/**
 * Return true if the draw is successful
 * @param threshold between 0 and 100
 */
export function performDraw(threshold) {
  return threshold !== 0 && Math.random() * 100 <= threshold
}

export function round(num, decimals) {
  return +num.toFixed(decimals)
}

export function msToNs(duration) {
  if (typeof duration !== 'number') {
    return duration
  }
  return round(duration * 1e6, 0)
}
export function mapValues(object, fn) {
  var newObject = {}
  each(object, function (value, key) {
    newObject[key] = fn(value)
  })

  return newObject
}

export function toServerDuration(duration) {
  if (!isNumber(duration)) {
    return duration
  }
  return round(duration * 1e6, 0)
}
export function getRelativeTime(timestamp) {
  return timestamp - getNavigationStart()
}
export function preferredNow() {
  return relativeNow()
}
export function getTimestamp(relativeTime) {
  return Math.round(getNavigationStart() + relativeTime)
}
export function relativeNow() {
  return performance.now()
}

export function clocksNow() {
  return { relative: relativeNow(), timeStamp: timeStampNow() }
}
export function timeStampNow() {
  return dateNow()
}

export function looksLikeRelativeTime(time) {
  return time < ONE_YEAR
}
export function dateNow() {
  // Do not use `Date.now` because sometimes websites are wrongly "polyfilling" it. For example, we
  // had some users using a very old version of `datejs`, which patched `Date.now` to return a Date
  // instance instead of a timestamp[1]. Those users are unlikely to fix this, so let's handle this
  // case ourselves.
  // [1]: https://github.com/datejs/Datejs/blob/97f5c7c58c5bc5accdab8aa7602b6ac56462d778/src/core-debug.js#L14-L16
  return new Date().getTime()
}

export function elapsed(start, end) {
  return end - start
}

export function clocksOrigin() {
  return { relative: 0, timeStamp: getNavigationStart() }
}
export function preferredClock(clocks) {
  return clocks.relative
}
export function preferredTimeStamp(clocks) {
  return getTimestamp(clocks.relative)
}
export function relativeToClocks(relative) {
  return { relative: relative, timeStamp: getCorrectedTimeStamp(relative) }
}
export function currentDrift() {
  // eslint-disable-next-line @typescript-eslint/restrict-plus-operands
  return Math.round(dateNow() - (getNavigationStart() + performance.now()))
}
export function addDuration(a, b) {
  return a + b
}
function getCorrectedTimeStamp(relativeTime) {
  var correctedOrigin = dateNow() - performance.now()
  // apply correction only for positive drift
  if (correctedOrigin > getNavigationStart()) {
    return Math.round(correctedOrigin + relativeTime)
  }
  return getTimestamp(relativeTime)
}
/**
 * Navigation start slightly change on some rare cases
 */
var navigationStart
export function getNavigationStart() {
  if (navigationStart === undefined) {
    navigationStart = performance.timing.navigationStart
  }
  return navigationStart
}
export function findCommaSeparatedValue(rawString, name) {
  var matches = rawString.match('(?:^|;)\\s*' + name + '\\s*=\\s*([^;]+)')
  return matches ? matches[1] : undefined
}
export function findByPath(source, path) {
  var pathArr = path.split('.')
  while (pathArr.length) {
    var key = pathArr.shift()
    if (source && key in source && hasOwnProperty.call(source, key)) {
      source = source[key]
    } else {
      return undefined
    }
  }
  return source
}
export function safeTruncate(candidate, length) {
  var lastChar = candidate.charCodeAt(length - 1)
  // check if it is the high part of a surrogate pair
  if (lastChar >= 0xd800 && lastChar <= 0xdbff) {
    return candidate.slice(0, length + 1)
  }
  return candidate.slice(0, length)
}

export function addEventListener(emitter, event, listener, options) {
  return addEventListeners(emitter, [event], listener, options)
}

/**
 * Add event listeners to an event emitter object (Window, Element, mock object...).  This provides
 * a few conveniences compared to using `element.addEventListener` directly:
 *
 * * supports IE11 by:
 *   * using an option object only if needed
 *   * emulating the `once` option
 *
 * * wraps the listener with a `monitor` function
 *
 * * returns a `stop` function to remove the listener
 *
 * * with `once: true`, the listener will be called at most once, even if different events are
 *   listened
 */
export function addEventListeners(emitter, events, listener, options) {
  var wrapedListener =
    options && options.once
      ? function (event) {
          stop()
          listener(event)
        }
      : listener

  options =
    options && options.passive
      ? { capture: options.capture, passive: options.passive }
      : options && options.capture
  each(events, function (event) {
    emitter.addEventListener(event, wrapedListener, options)
  })
  var stop = function () {
    each(events, function (event) {
      emitter.removeEventListener(event, wrapedListener, options)
    })
  }
  return {
    stop: stop
  }
}

export function includes(candidate, search) {
  // tslint:disable-next-line: no-unsafe-any
  return candidate.indexOf(search) !== -1
}

export function createContextManager() {
  var context = {}

  return {
    get: function () {
      return context
    },

    add: function (key, value) {
      if (isString(key)) {
        context[key] = value
      } else {
        console.error('key 需要传递字符串类型')
      }
    },

    remove: function (key) {
      delete context[key]
    },

    set: function (newContext) {
      if (isObject(newContext)) {
        context = newContext
      } else {
        console.error('content 需要传递对象类型数据')
      }
    },
    getContext: function () {
      return deepClone(context)
    },

    setContext: function (newContext) {
      context = deepClone(newContext)
    },

    setContextProperty: function (key, property) {
      context[key] = deepClone(property)
    },

    removeContextProperty: function (key) {
      delete context[key]
    },

    clearContext: function () {
      context = {}
    }
  }
}
export function find(array, predicate) {
  for (var i = 0; i < array.length; i += 1) {
    var item = array[i]
    if (predicate(item, i, array)) {
      return item
    }
  }
  return undefined
}
export function arrayFrom(arrayLike) {
  if (Array.from) {
    return Array.from(arrayLike)
  }
  var array = []
  if (arrayLike instanceof Set) {
    arrayLike.forEach(function (item) {
      array.push(item)
    })
  } else {
    for (var i = 0; i < arrayLike.length; i++) {
      array.push(arrayLike[i])
    }
  }
  return array
}
export function findLast(array, predicate) {
  for (var i = array.length - 1; i >= 0; i -= 1) {
    var item = array[i]
    if (predicate(item, i, array)) {
      return item
    }
  }
  return undefined
}
export function isPercentage(value) {
  return isNumber(value) && value >= 0 && value <= 100
}

export function getLocationOrigin() {
  return getLinkElementOrigin(window.location)
}

export function isIE() {
  return Boolean(document.documentMode)
}

export function isChromium() {
  return !!window.chrome || /HeadlessChrome/.test(window.navigator.userAgent)
}

/**
 * IE fallback
 * https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/origin
 */
export function getLinkElementOrigin(element) {
  if (element.origin) {
    return element.origin
  }
  var sanitizedHost = element.host.replace(/(:80|:443)$/, '')
  return element.protocol + '//' + sanitizedHost
}

export function withSnakeCaseKeys(candidate) {
  var result = {}
  each(candidate, function (value, key) {
    result[toSnakeCase(key)] = deepSnakeCase(value)
  })
  return result
}

export function deepSnakeCase(candidate) {
  if (isArray(candidate)) {
    return map(candidate, function (value) {
      return deepSnakeCase(value)
    })
  }
  if (typeof candidate === 'object' && candidate !== null) {
    return withSnakeCaseKeys(candidate)
  }
  return candidate
}

export function toSnakeCase(word) {
  return word
    .replace(/[A-Z]/g, function (uppercaseLetter, index) {
      return (index !== 0 ? '_' : '') + uppercaseLetter.toLowerCase()
    })
    .replace(/-/g, '_')
}

export function escapeRowData(str) {
  if (typeof str === 'object' && str) {
    str = jsonStringify(str)
  } else if (!isString(str)) {
    return str
  }
  var reg = /[\s=,"]/g
  return String(str).replace(reg, function (word) {
    return '\\' + word
  })
}

export function escapeJsonValue(value) {
  if (isString(value)) {
    return value
  } else {
    return jsonStringify(value)
  }
}
export function escapeFieldValueStr(str) {
  return (
    '"' +
    str
      .replace(/[\\]*"/g, '"')
      .replace(/"/g, '\\"')
      .replace(/\\/g, '\\\\') +
    '"'
  )
}
export function escapeRowField(value) {
  if (typeof value === 'object' && value) {
    return escapeFieldValueStr(jsonStringify(value))
  } else if (isString(value)) {
    return escapeFieldValueStr(value)
  } else {
    return value
  }
}
export function isNullUndefinedDefaultValue(data, defaultValue) {
  if (data !== null && data !== void 0) {
    return data
  } else {
    return defaultValue
  }
}

export function runOnReadyState(expectedReadyState, callback) {
  if (
    document.readyState === expectedReadyState ||
    document.readyState === 'complete'
  ) {
    callback()
  } else {
    var eventName =
      expectedReadyState === 'complete'
        ? DOM_EVENT.LOAD
        : DOM_EVENT.DOM_CONTENT_LOADED
    addEventListener(window, eventName, callback, { once: true })
  }
}

export function requestIdleCallback(callback, opts) {
  // Use 'requestIdleCallback' when available: it will throttle the mutation processing if the
  // browser is busy rendering frames (ex: when frames are below 60fps). When not available, the
  // fallback on 'requestAnimationFrame' will still ensure the mutations are processed after any
  // browser rendering process (Layout, Recalculate Style, etc.), so we can serialize DOM nodes
  // efficiently.
  if (window.requestIdleCallback) {
    var id = window.requestIdleCallback(callback, opts)
    return function () {
      return window.cancelIdleCallback(id)
    }
  }
  var id = window.requestAnimationFrame(callback)
  return function () {
    return window.cancelAnimationFrame(id)
  }
}
export function objectHasValue(object, value) {
  return some(keys(object), function (key) {
    return object[key] === value
  })
}
export function startsWith(candidate, search) {
  return candidate.slice(0, search.length) === search
}

export function endsWith(candidate, search) {
  return candidate.slice(-search.length) === search
}
