import {
  getParentNode,
  isNodeShadowRoot,
  buildUrl,
  isSafari
} from '@cloudcare/browser-core'
import { CENSORED_STRING_MARK } from '../../../constants'
import { shouldMaskNode } from './privacy'

var serializedNodeIds = new WeakMap()

export function hasSerializedNode(node) {
  return serializedNodeIds.has(node)
}

export function nodeAndAncestorsHaveSerializedNode(node) {
  var current = node
  while (current) {
    if (!hasSerializedNode(current) && !isNodeShadowRoot(current)) {
      return false
    }
    current = getParentNode(current)
  }
  return true
}

export function getSerializedNodeId(node) {
  return serializedNodeIds.get(node)
}

export function setSerializedNodeId(node, serializeNodeId) {
  serializedNodeIds.set(node, serializeNodeId)
}

/**
 * Get the element "value" to be serialized as an attribute or an input update record. It respects
 * the input privacy mode of the element.
 * PERFROMANCE OPTIMIZATION: Assumes that privacy level `HIDDEN` is never encountered because of earlier checks.
 */
export function getElementInputValue(configuration, element, nodePrivacyLevel) {
  /*
   BROWSER SPEC NOTE: <input>, <select>
   For some <input> elements, the `value` is an exceptional property/attribute that has the
   value synced between el.value and el.getAttribute()
   input[type=button,checkbox,hidden,image,radio,reset,submit]
   */
  var tagName = element.tagName
  var value = element.value
  if (shouldMaskNode(configuration, element, nodePrivacyLevel)) {
    var type = element.type
    if (
      tagName === 'INPUT' &&
      (type === 'button' ||
        type === 'submit' ||
        type === 'reset' ||
        type === 'range')
    ) {
      // Overrule `MASK` privacy level for button-like element values, as they are used during replay
      // to display their label. They can still be hidden via the "hidden" privacy attribute or class name.
      return value
    } else if (!value || tagName === 'OPTION') {
      // <Option> value provides no benefit
      return
    }
    return CENSORED_STRING_MARK
  }

  if (tagName === 'OPTION' || tagName === 'SELECT') {
    return element.value
  }

  if (tagName !== 'INPUT' && tagName !== 'TEXTAREA') {
    return
  }

  return value
}
function extractOrigin(url) {
  var origin = ''
  if (url.indexOf('//') > -1) {
    origin = url.split('/').slice(0, 3).join('/')
  } else {
    origin = url.split('/')[0]
  }
  origin = origin.split('?')[0]
  return origin
}
export var URL_IN_CSS_REF = /url\((?:(')([^']*)'|(")([^"]*)"|([^)]*))\)/gm
export var ABSOLUTE_URL = /^[A-Za-z]+:|^\/\//
export var DATA_URI = /^data:.*,/i
/**
 * Browsers sometimes destructively modify the css rules they receive.
 * This function tries to rectify the modifications the browser made to make it more cross platform compatible.
 * @param cssText - output of `CSSStyleRule.cssText`
 * @returns `cssText` with browser inconsistencies fixed.
 */
export function fixBrowserCompatibilityIssuesInCSS(cssText) {
  /**
   * Chrome outputs `-webkit-background-clip` as `background-clip` in `CSSStyleRule.cssText`.
   * But then Chrome ignores `background-clip` as css input.
   * Re-introduce `-webkit-background-clip` to fix this issue.
   */
  if (
    cssText.includes(' background-clip: text;') &&
    !cssText.includes(' -webkit-background-clip: text;')
  ) {
    cssText = cssText.replace(
      ' background-clip: text;',
      ' -webkit-background-clip: text; background-clip: text;'
    )
  }
  return cssText
}
export function getHref() {
  var a = document.createElement('a')
  a.href = ''
  return a.href
}
export function switchToAbsoluteUrl(cssText, cssHref) {
  return cssText.replace(
    URL_IN_CSS_REF,
    function (
      matchingSubstring,
      singleQuote,
      urlWrappedInSingleQuotes,
      doubleQuote,
      urlWrappedInDoubleQuotes,
      urlNotWrappedInQuotes
    ) {
      var url =
        urlWrappedInSingleQuotes ||
        urlWrappedInDoubleQuotes ||
        urlNotWrappedInQuotes

      if (!cssHref || !url || ABSOLUTE_URL.test(url) || DATA_URI.test(url)) {
        return matchingSubstring
      }
      var quote = singleQuote || doubleQuote || ''
      if (url[0] === '/') {
        return 'url('
          .concat(quote)
          .concat(extractOrigin(cssHref) + url)
          .concat(quote, ')')
      }
      return `url(${quote}${makeUrlAbsolute(url, cssHref)}${quote})`
    }
  )
}
export function getCssRulesString(cssStyleSheet) {
  if (!cssStyleSheet) {
    return null
  }
  var rules
  try {
    rules = cssStyleSheet.rules || cssStyleSheet.cssRules
  } catch {
    // if css is protected by CORS we cannot access cssRules see: https://www.w3.org/TR/cssom-1/#the-cssstylesheet-interface
  }
  if (!rules) {
    return null
  }
  var styleSheetCssText = fixBrowserCompatibilityIssuesInCSS(
    Array.from(
      rules,
      isSafari() ? getCssRuleStringForSafari : getCssRuleString
    ).join('')
  )
  return switchToAbsoluteUrl(styleSheetCssText, cssStyleSheet.href)
}
export function isCSSImportRule(rule) {
  return 'styleSheet' in rule
}

export function isSVGElement(el) {
  return el.tagName === 'svg' || el instanceof SVGElement
}
export function getCssRuleString(rule) {
  return (
    (isCSSImportRule(rule) && getCssRulesString(rule.styleSheet)) ||
    rule.cssText
  )
}
export function makeUrlAbsolute(url, baseUrl) {
  try {
    return buildUrl(url, baseUrl).href
  } catch (_) {
    return url
  }
}
function isCSSStyleRule(rule) {
  return 'selectorText' in rule
}
function getCssRuleStringForSafari(rule) {
  // Safari does not escape attribute selectors containing : properly
  // https://bugs.webkit.org/show_bug.cgi?id=184604
  if (isCSSStyleRule(rule) && rule.selectorText.includes(':')) {
    // This regex replaces [foo:bar] by [foo\\:bar]
    const escapeColon = /(\[[\w-]+[^\\])(:[^\]]+\])/g
    return rule.cssText.replace(escapeColon, '$1\\$2')
  }

  return getCssRuleString(rule)
}

export function serializeStyleSheets(cssStyleSheets) {
  if (cssStyleSheets === undefined || cssStyleSheets.length === 0) {
    return undefined
  }
  return cssStyleSheets.map(function (cssStyleSheet) {
    var rules = cssStyleSheet.cssRules || cssStyleSheet.rules
    var cssRules = Array.from(rules, function (cssRule) {
      return cssRule.cssText
    })

    var styleSheet = {
      cssRules: cssRules,
      disabled: cssStyleSheet.disabled || undefined,
      media:
        cssStyleSheet.media.length > 0
          ? Array.from(cssStyleSheet.media)
          : undefined
    }
    return styleSheet
  })
}
export function absoluteToDoc(doc, attributeValue) {
  if (!attributeValue || attributeValue.trim() === '') {
    return attributeValue
  }
  var a = doc.createElement('a')
  a.href = attributeValue
  return a.href
}

var SRCSET_NOT_SPACES = /^[^ \t\n\r\u000c]+/
var SRCSET_COMMAS_OR_SPACES = /^[, \t\n\r\u000c]+/
export function getAbsoluteSrcsetString(doc, attributeValue) {
  if (attributeValue.trim() === '') {
    return attributeValue
  }
  var pos = 0
  function collectCharacters(regEx) {
    var chars
    var match = regEx.exec(attributeValue.substring(pos))
    if (match) {
      chars = match[0]
      pos += chars.length
      return chars
    }
    return ''
  }
  var output = []
  while (true) {
    collectCharacters(SRCSET_COMMAS_OR_SPACES)
    if (pos >= attributeValue.length) {
      break
    }
    var url = collectCharacters(SRCSET_NOT_SPACES)
    if (url.slice(-1) === ',') {
      url = absoluteToDoc(doc, url.substring(0, url.length - 1))
      output.push(url)
    } else {
      var descriptorsStr = ''
      url = absoluteToDoc(doc, url)
      var inParens = false
      while (true) {
        var c = attributeValue.charAt(pos)
        if (c === '') {
          output.push((url + descriptorsStr).trim())
          break
        } else if (!inParens) {
          if (c === ',') {
            pos += 1
            output.push((url + descriptorsStr).trim())
            break
          } else if (c === '(') {
            inParens = true
          }
        } else {
          if (c === ')') {
            inParens = false
          }
        }
        descriptorsStr += c
        pos += 1
      }
    }
  }
  return output.join(', ')
}
