import { each, isArray, map, some, keys } from './c'
/**
 * IE fallback
 * https://developer.mozilla.org/en-US/docs/Web/API/HTMLHyperlinkElementUtils/origin
 */
export function getLinkElementOrigin(element) {
  if (element.origin && element.origin !== 'null') {
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

export function isNullUndefinedDefaultValue(data, defaultValue) {
  if (data !== null && data !== void 0) {
    return data
  } else {
    return defaultValue
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

export function tryToClone(response) {
  try {
    return response.clone()
  } catch (e) {
    // clone can throw if the response has already been used by another instrumentation or is disturbed
    return
  }
}
export function isHashAnAnchor(hash) {
  var correspondingId = hash.substr(1)
  if (!correspondingId) return false
  return !!document.getElementById(correspondingId)
}
export function getPathFromHash(hash) {
  var index = hash.indexOf('?')
  return index < 0 ? hash : hash.slice(0, index)
}
export function longtask() {
  const start = performance.now()
  while (performance.now() - start < 150) {
    // 做点没用的运算，让主线程卡住
    Math.sqrt(Math.random() * 1e8)
  }
}
export function longtask2() {
  const start = performance.now()
  while (performance.now() - start < 200) {
    // 做点没用的运算，让主线程卡住
    Math.sqrt(Math.random() * 1e8)
  }
}
export function heavyComputation(name) {
  longtask()
  const a = '===name' + name
  console.log(a)
  longtask2()
}
