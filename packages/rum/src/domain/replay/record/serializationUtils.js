import {
  getParentNode,
  isNodeShadowRoot,
  buildUrl,
  isSafari
} from '@cloudcare/browser-core'
import { CENSORED_STRING_MARK } from '../../../constants'
import { shouldMaskNode } from './privacy'

var serializedNodeIds = new WeakMap()
export var MAX_SERIALIZED_CANVAS_REGISTRY_SIZE = 2048
export var MAX_SERIALIZED_NODE_ANCESTOR_DEPTH = 1000
export var STYLESHEET_SERIALIZATION_MAX_RULE_COUNT = 5000
export var STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT = 256 * 1024
export var STYLESHEET_SERIALIZATION_MAX_DURATION_MS = 4
var serializedCanvasEntries = []
var serializedCanvasFreeEntryIndexes = []
var serializedCanvasEntryByNode = new WeakMap()
var serializedCanvasEntryCount = 0
var serializedCanvasNextEvictionIndex = 0
var serializedCanvasScanCursor = 0
var serializedCanvasScanRemaining = 0
var serializedCanvasTrackingCount = 0
var anchorElementByDocument = new WeakMap()
var hrefByDocument = new WeakMap()

export function getHiddenElementPlaceholderSize(element) {
  var width =
    element.getAttribute('width') ||
    (element.style && element.style.width) ||
    undefined
  var height =
    element.getAttribute('height') ||
    (element.style && element.style.height) ||
    undefined

  return {
    width: width,
    height: height
  }
}

export function hasSerializedNode(node) {
  return serializedNodeIds.has(node)
}

export function nodeAndAncestorsHaveSerializedNode(node) {
  var current = node
  var depth = 0
  while (current) {
    if (depth >= MAX_SERIALIZED_NODE_ANCESTOR_DEPTH) {
      return false
    }
    if (!hasSerializedNode(current) && !isNodeShadowRoot(current)) {
      return false
    }
    depth += 1
    current = getParentNode(current)
  }
  return true
}

export function getSerializedNodeId(node) {
  return serializedNodeIds.get(node)
}

export function setSerializedNodeId(node, serializeNodeId) {
  serializedNodeIds.set(node, serializeNodeId)
  if (
    serializedCanvasTrackingCount > 0 &&
    node instanceof HTMLCanvasElement
  ) {
    registerSerializedCanvasNode(node)
  }
}

export function startSerializedCanvasTracking() {
  serializedCanvasTrackingCount += 1
  var stopped = false

  return function stopSerializedCanvasTracking() {
    if (stopped) {
      return
    }
    stopped = true
    serializedCanvasTrackingCount -= 1
    if (serializedCanvasTrackingCount === 0) {
      clearSerializedCanvasRegistry()
    }
  }
}

function isSerializedCanvasConnectedToDocument(node) {
  var isConnected = node.isConnected
  if (typeof isConnected === 'boolean') {
    return isConnected
  }

  var current = node

  while (current) {
    if (current === document) {
      return true
    }
    current = getParentNode(current)
  }

  return false
}

function registerSerializedCanvasNode(node) {
  var existingEntry = serializedCanvasEntryByNode.get(node)
  if (existingEntry && existingEntry.active) {
    return
  }

  var entry = {
    active: true,
    weakRef:
      typeof WeakRef === 'function' ? new WeakRef(node) : undefined,
    node: typeof WeakRef === 'function' ? undefined : node
  }
  var entryIndex
  if (serializedCanvasFreeEntryIndexes.length) {
    entryIndex = serializedCanvasFreeEntryIndexes.pop()
  } else if (
    serializedCanvasEntries.length <
    MAX_SERIALIZED_CANVAS_REGISTRY_SIZE
  ) {
    entryIndex = serializedCanvasEntries.length
  } else {
    entryIndex = serializedCanvasNextEvictionIndex
    serializedCanvasNextEvictionIndex =
      (serializedCanvasNextEvictionIndex + 1) %
      MAX_SERIALIZED_CANVAS_REGISTRY_SIZE
    var evictedEntry = serializedCanvasEntries[entryIndex]
    if (evictedEntry && evictedEntry.active) {
      evictedEntry.active = false
      serializedCanvasEntryCount -= 1
    }
  }

  entry.index = entryIndex
  serializedCanvasEntries[entryIndex] = entry
  serializedCanvasEntryByNode.set(node, entry)
  serializedCanvasEntryCount += 1
}

function getSerializedCanvasEntryNode(entry) {
  if (!entry || !entry.active) {
    return
  }
  return entry.weakRef ? entry.weakRef.deref() : entry.node
}

function pruneSerializedCanvasEntry(entry) {
  if (!entry || !entry.active) {
    return
  }
  entry.active = false
  entry.node = undefined
  if (serializedCanvasEntries[entry.index] === entry) {
    serializedCanvasEntries[entry.index] = undefined
    serializedCanvasFreeEntryIndexes.push(entry.index)
  }
  serializedCanvasEntryCount = Math.max(
    serializedCanvasEntryCount - 1,
    0
  )
}

function clearSerializedCanvasRegistry() {
  serializedCanvasEntries = []
  serializedCanvasFreeEntryIndexes = []
  serializedCanvasEntryByNode = new WeakMap()
  serializedCanvasEntryCount = 0
  serializedCanvasNextEvictionIndex = 0
  resetSerializedCanvasScan()
}

function resetSerializedCanvasScan() {
  serializedCanvasScanCursor = 0
  serializedCanvasScanRemaining = 0
}

export function getSerializedCanvasNodes(maxScanCount) {
  if (typeof maxScanCount === 'number') {
    return getSerializedCanvasNodesWithinScanLimit(maxScanCount)
  }

  var connectedSerializedCanvasNodes = []
  for (
    var entryIndex = 0;
    entryIndex < serializedCanvasEntries.length;
    entryIndex += 1
  ) {
    var entry = serializedCanvasEntries[entryIndex]
    var node = getSerializedCanvasEntryNode(entry)
    if (hasSerializedNode(node) && isSerializedCanvasConnectedToDocument(node)) {
      connectedSerializedCanvasNodes.push(node)
    } else {
      pruneSerializedCanvasEntry(entry)
    }
  }
  resetSerializedCanvasScan()

  return connectedSerializedCanvasNodes
}

export function getSerializedCanvasNodesSnapshot(maxScanCount) {
  var resultLimit = Math.max(Math.floor(maxScanCount), 0)
  if (
    !isFinite(resultLimit) ||
    resultLimit === 0 ||
    !serializedCanvasEntryCount ||
    !serializedCanvasEntries.length
  ) {
    return []
  }

  // Full-snapshot bitmap baselines need a complete bounded view independent
  // from the partial round-robin pass shared by continuous and command
  // schedulers. Scan the bounded registry until enough active canvases are
  // collected so sparse/disconnected slots cannot hide later canvases, without
  // reading or updating the shared cursor.
  var connectedSerializedCanvasNodes = []
  for (
    var entryIndex = 0;
    entryIndex < serializedCanvasEntries.length &&
    connectedSerializedCanvasNodes.length < resultLimit;
    entryIndex += 1
  ) {
    var entry = serializedCanvasEntries[entryIndex]
    var node = getSerializedCanvasEntryNode(entry)
    if (hasSerializedNode(node) && isSerializedCanvasConnectedToDocument(node)) {
      connectedSerializedCanvasNodes.push(node)
    } else {
      pruneSerializedCanvasEntry(entry)
    }
  }
  return connectedSerializedCanvasNodes
}

function getSerializedCanvasNodesWithinScanLimit(maxScanCount) {
  var scanLimit = Math.max(Math.floor(maxScanCount), 0)
  if (
    !isFinite(scanLimit) ||
    scanLimit === 0 ||
    !serializedCanvasEntryCount ||
    !serializedCanvasEntries.length
  ) {
    return []
  }
  if (!serializedCanvasScanRemaining) {
    serializedCanvasScanCursor = 0
    serializedCanvasScanRemaining = serializedCanvasEntries.length
  }

  var connectedSerializedCanvasNodes = []
  var scannedNodeCount = 0
  while (
    scannedNodeCount < scanLimit &&
    serializedCanvasScanRemaining > 0
  ) {
    var entry = serializedCanvasEntries[serializedCanvasScanCursor]
    serializedCanvasScanCursor =
      (serializedCanvasScanCursor + 1) %
      serializedCanvasEntries.length
    scannedNodeCount += 1
    serializedCanvasScanRemaining -= 1

    var node = getSerializedCanvasEntryNode(entry)
    if (hasSerializedNode(node) && isSerializedCanvasConnectedToDocument(node)) {
      connectedSerializedCanvasNodes.push(node)
    } else {
      pruneSerializedCanvasEntry(entry)
    }
  }

  if (serializedCanvasScanRemaining === 0) {
    resetSerializedCanvasScan()
  }
  return connectedSerializedCanvasNodes
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
  return getDocumentHref(document)
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
  var rootRules = getReadableStyleSheetRules(cssStyleSheet)
  if (!rootRules) {
    return null
  }
  var serializationState = {
    parts: [],
    visitedStyleSheets: new Set(),
    ruleCount: 0,
    characterCount: 0,
    deadline:
      getSerializationTime() + STYLESHEET_SERIALIZATION_MAX_DURATION_MS,
    exceeded: false
  }
  if (
    !appendStyleSheetRules(
      cssStyleSheet,
      serializationState,
      cssStyleSheet.href,
      rootRules
    )
  ) {
    return null
  }
  var styleSheetCssText = fixBrowserCompatibilityIssuesInCSS(
    serializationState.parts.join('')
  )
  if (
    styleSheetCssText.length >
    STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT
  ) {
    return null
  }
  return styleSheetCssText
}

function appendStyleSheetRules(
  cssStyleSheet,
  serializationState,
  inheritedHref,
  knownRules
) {
  if (
    !cssStyleSheet ||
    serializationState.visitedStyleSheets.has(cssStyleSheet)
  ) {
    return true
  }
  if (!hasStyleSheetSerializationBudget(serializationState)) {
    return false
  }
  serializationState.visitedStyleSheets.add(cssStyleSheet)
  var styleSheetHref = cssStyleSheet.href || inheritedHref
  var rules = knownRules || getReadableStyleSheetRules(cssStyleSheet)
  if (!rules) {
    return false
  }
  for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
    var rule = rules[ruleIndex]
    if (isCSSImportRule(rule)) {
      var importedHref =
        (rule.styleSheet && rule.styleSheet.href) ||
        (rule.href && styleSheetHref
          ? makeUrlAbsolute(rule.href, styleSheetHref)
          : rule.href)
      var importedRules = getReadableStyleSheetRules(rule.styleSheet)
      if (importedRules) {
        if (
          !appendStyleSheetRules(
            rule.styleSheet,
            serializationState,
            importedHref,
            importedRules
          )
        ) {
          return false
        }
      } else if (
        !appendStyleSheetRuleText(
          rule,
          serializationState,
          styleSheetHref,
          false
        )
      ) {
        return false
      }
      continue
    }
    if (
      !appendStyleSheetRuleText(
        rule,
        serializationState,
        styleSheetHref,
        true
      )
    ) {
      return false
    }
  }
  return true
}

function getReadableStyleSheetRules(cssStyleSheet) {
  if (!cssStyleSheet) {
    return
  }
  try {
    return cssStyleSheet.rules || cssStyleSheet.cssRules
  } catch (_) {
    // If CSS is protected by CORS we cannot access cssRules. The containing
    // @import rule itself is still useful and is retained by the caller.
    // See https://www.w3.org/TR/cssom-1/#the-cssstylesheet-interface.
  }
}

function appendStyleSheetRuleText(
  rule,
  serializationState,
  styleSheetHref,
  shouldPatchSafari
) {
  var rawRuleText = rule && rule.cssText
  if (typeof rawRuleText !== 'string') {
    return true
  }
  if (
    !hasStyleSheetSerializationBudget(
      serializationState,
      rawRuleText.length
    )
  ) {
    return false
  }
  var ruleText =
    shouldPatchSafari && isSafari()
      ? getCssRuleStringForSafari(rule)
      : rawRuleText
  ruleText = switchToAbsoluteUrl(ruleText, styleSheetHref)
  if (
    ruleText.length !== rawRuleText.length &&
    !hasStyleSheetSerializationBudget(
      serializationState,
      ruleText.length - rawRuleText.length,
      false
    )
  ) {
    return false
  }
  serializationState.ruleCount += 1
  serializationState.characterCount += ruleText.length
  serializationState.parts.push(ruleText)
  return true
}

function hasStyleSheetSerializationBudget(
  serializationState,
  additionalCharacterCount,
  shouldCountRule
) {
  if (additionalCharacterCount === undefined) {
    additionalCharacterCount = 0
  }
  if (shouldCountRule === undefined) {
    shouldCountRule = true
  }
  if (
    serializationState.exceeded ||
    (shouldCountRule &&
      serializationState.ruleCount >=
        STYLESHEET_SERIALIZATION_MAX_RULE_COUNT) ||
    serializationState.characterCount + additionalCharacterCount >
      STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT ||
    getSerializationTime() > serializationState.deadline
  ) {
    serializationState.exceeded = true
    return false
  }
  return true
}

function getSerializationTime() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
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
  var serializedStyleSheets = []
  var serializationState = {
    ruleCount: 0,
    characterCount: 0,
    deadline:
      getSerializationTime() + STYLESHEET_SERIALIZATION_MAX_DURATION_MS,
    exceeded: false
  }
  for (
    var styleSheetIndex = 0;
    styleSheetIndex < cssStyleSheets.length;
    styleSheetIndex += 1
  ) {
    var cssStyleSheet = cssStyleSheets[styleSheetIndex]
    if (!hasStyleSheetSerializationBudget(serializationState, 0, false)) {
      break
    }
    var rules = getReadableStyleSheetRules(cssStyleSheet)
    if (!rules) {
      continue
    }
    var cssRules = []
    var completed = true
    for (var ruleIndex = 0; ruleIndex < rules.length; ruleIndex += 1) {
      var cssText = rules[ruleIndex].cssText
      if (typeof cssText !== 'string') {
        continue
      }
      if (
        !hasStyleSheetSerializationBudget(
          serializationState,
          cssText.length
        )
      ) {
        completed = false
        break
      }
      serializationState.ruleCount += 1
      serializationState.characterCount += cssText.length
      cssRules.push(cssText)
    }
    if (!completed) {
      break
    }

    var styleSheet = {
      cssRules: cssRules,
      disabled: cssStyleSheet.disabled || undefined,
      media:
        cssStyleSheet.media.length > 0
          ? Array.from(cssStyleSheet.media)
          : undefined
    }
    serializedStyleSheets.push(styleSheet)
  }
  return serializedStyleSheets
}
export function absoluteToDoc(doc, attributeValue) {
  if (!attributeValue || attributeValue.trim() === '') {
    return attributeValue
  }
  var a = getAnchorElement(doc)
  a.href = attributeValue
  return a.href
}

function getAnchorElement(doc) {
  var anchor = anchorElementByDocument.get(doc)
  if (!anchor) {
    anchor = doc.createElement('a')
    anchorElementByDocument.set(doc, anchor)
  }
  return anchor
}

function getDocumentHref(doc) {
  var href = hrefByDocument.get(doc)
  if (!href) {
    var anchor = getAnchorElement(doc)
    anchor.href = ''
    href = anchor.href
    hrefByDocument.set(doc, href)
  }
  return href
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
