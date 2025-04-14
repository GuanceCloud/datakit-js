import {
  isElementNode,
  getParentNode,
  isTextNode
} from '@cloudcare/browser-core'

import {
  NodePrivacyLevel,
  PRIVACY_ATTR_NAME,
  PRIVACY_ATTR_VALUE_ALLOW,
  PRIVACY_ATTR_VALUE_MASK,
  PRIVACY_ATTR_VALUE_MASK_USER_INPUT,
  PRIVACY_ATTR_VALUE_HIDDEN,
  PRIVACY_CLASS_ALLOW,
  PRIVACY_CLASS_MASK,
  PRIVACY_CLASS_MASK_USER_INPUT,
  PRIVACY_CLASS_HIDDEN,
  FORM_PRIVATE_TAG_NAMES,
  CENSORED_STRING_MARK
} from '../../../constants'

export var MAX_ATTRIBUTE_VALUE_CHAR_LENGTH = 100_000

var TEXT_MASKING_CHAR = 'x'

/**
 * Get node privacy level by iterating over its ancestors. When the direct parent privacy level is
 * know, it is best to use something like:
 *
 * derivePrivacyLevelGivenParent(getNodeSelfPrivacyLevel(node), parentNodePrivacyLevel)
 */
export function getNodePrivacyLevel(node, defaultPrivacyLevel, cache) {
  if (cache && cache.has(node)) {
    return cache.get(node)
  }
  var parentNode = getParentNode(node)
  var parentNodePrivacyLevel = parentNode
    ? getNodePrivacyLevel(parentNode, defaultPrivacyLevel)
    : defaultPrivacyLevel
  var selfNodePrivacyLevel = getNodeSelfPrivacyLevel(node)
  var nodePrivacyLevel = reducePrivacyLevel(
    selfNodePrivacyLevel,
    parentNodePrivacyLevel
  )
  if (cache) {
    cache.set(node, nodePrivacyLevel)
  }
  return nodePrivacyLevel
}

/**
 * Reduces the next privacy level based on self + parent privacy levels
 */
export function reducePrivacyLevel(childPrivacyLevel, parentNodePrivacyLevel) {
  switch (parentNodePrivacyLevel) {
    // These values cannot be overridden
    case NodePrivacyLevel.HIDDEN:
    case NodePrivacyLevel.IGNORE:
      return parentNodePrivacyLevel
  }
  switch (childPrivacyLevel) {
    case NodePrivacyLevel.ALLOW:
    case NodePrivacyLevel.MASK:
    case NodePrivacyLevel.MASK_USER_INPUT:
    case NodePrivacyLevel.HIDDEN:
    case NodePrivacyLevel.IGNORE:
      return childPrivacyLevel
    default:
      return parentNodePrivacyLevel
  }
}

/**
 * Determines the node's own privacy level without checking for ancestors.
 */
export function getNodeSelfPrivacyLevel(node) {
  // Only Element types can have a privacy level set
  if (!isElementNode(node)) {
    return
  }

  var privAttr = node.getAttribute(PRIVACY_ATTR_NAME)

  // Overrules for replay purpose
  if (node.tagName === 'BASE') {
    return NodePrivacyLevel.ALLOW
  }

  // Overrules to enforce end-user protection
  if (node.tagName === 'INPUT') {
    var inputElement = node
    if (
      inputElement.type === 'password' ||
      inputElement.type === 'email' ||
      inputElement.type === 'tel'
    ) {
      return NodePrivacyLevel.MASK
    }
    if (inputElement.type === 'hidden') {
      return NodePrivacyLevel.MASK
    }
    var autocomplete = inputElement.getAttribute('autocomplete')
    // Handle input[autocomplete=cc-number/cc-csc/cc-exp/cc-exp-month/cc-exp-year]
    if (autocomplete && autocomplete.indexOf('cc-') === 0) {
      return NodePrivacyLevel.MASK
    }
  }

  // Check HTML privacy attributes and classes
  if (
    privAttr === PRIVACY_ATTR_VALUE_HIDDEN ||
    node.classList.contains(PRIVACY_CLASS_HIDDEN)
  ) {
    return NodePrivacyLevel.HIDDEN
  }

  if (
    privAttr === PRIVACY_ATTR_VALUE_MASK ||
    node.classList.contains(PRIVACY_CLASS_MASK)
  ) {
    return NodePrivacyLevel.MASK
  }

  if (
    privAttr === PRIVACY_ATTR_VALUE_MASK_USER_INPUT ||
    node.classList.contains(PRIVACY_CLASS_MASK_USER_INPUT)
  ) {
    return NodePrivacyLevel.MASK_USER_INPUT
  }

  if (
    privAttr === PRIVACY_ATTR_VALUE_ALLOW ||
    node.classList.contains(PRIVACY_CLASS_ALLOW)
  ) {
    return NodePrivacyLevel.ALLOW
  }

  if (shouldIgnoreElement(node)) {
    return NodePrivacyLevel.IGNORE
  }
}

/**
 * Helper aiming to unify `mask` and `mask-user-input` privacy levels:
 *
 * In the `mask` case, it is trivial: we should mask the element.
 *
 * In the `mask-user-input` case, we should mask the element only if it is a "form" element or the
 * direct parent is a form element for text nodes).
 *
 * Other `shouldMaskNode` cases are edge cases that should not matter too much (ex: should we mask a
 * node if it is ignored or hidden? it doesn't matter since it won't be serialized).
 */
export function shouldMaskNode(configuration, node, privacyLevel) {
  if (
    configuration.shouldMaskNode &&
    configuration.shouldMaskNode(node, privacyLevel) === true
  )
    return true
  switch (privacyLevel) {
    case NodePrivacyLevel.MASK:
    case NodePrivacyLevel.HIDDEN:
    case NodePrivacyLevel.IGNORE:
      return true
    case NodePrivacyLevel.MASK_USER_INPUT:
      return isTextNode(node)
        ? isFormElement(node.parentNode)
        : isFormElement(node)
    default:
      return false
  }
}

function isFormElement(node) {
  if (!node || node.nodeType !== node.ELEMENT_NODE) {
    return false
  }
  var element = node
  if (element.tagName === 'INPUT') {
    switch (element.type) {
      case 'button':
      case 'color':
      case 'reset':
      case 'submit':
        return false
    }
  }
  return !!FORM_PRIVATE_TAG_NAMES[element.tagName]
}

/**
 * Text censoring non-destructively maintains whitespace characters in order to preserve text shape
 * during replay.
 */
export var censorText = function (text) {
  return text.replace(/\S/g, TEXT_MASKING_CHAR)
}

export function getTextContent(
  configuration,
  textNode,
  ignoreWhiteSpace,
  parentNodePrivacyLevel
) {
  // The parent node may not be a html element which has a tagName attribute.
  // So just let it be undefined which is ok in this use case.
  var parentTagName = textNode.parentElement && textNode.parentElement.tagName
  var textContent = textNode.textContent || ''

  if (ignoreWhiteSpace && !textContent.trim()) {
    return
  }

  var nodePrivacyLevel = parentNodePrivacyLevel

  //   var isStyle = parentTagName === 'STYLE' ? true : undefined
  var isScript = parentTagName === 'SCRIPT'

  if (isScript) {
    // For perf reasons, we don't record script (heuristic)
    textContent = CENSORED_STRING_MARK
  } else if (nodePrivacyLevel === NodePrivacyLevel.HIDDEN) {
    // Should never occur, but just in case, we set to CENSORED_MARK.
    textContent = CENSORED_STRING_MARK
  } else if (shouldMaskNode(configuration, textNode, nodePrivacyLevel)) {
    if (
      // Scrambling the child list breaks text nodes for DATALIST/SELECT/OPTGROUP
      parentTagName === 'DATALIST' ||
      parentTagName === 'SELECT' ||
      parentTagName === 'OPTGROUP'
    ) {
      if (!textContent.trim()) {
        return
      }
    } else if (parentTagName === 'OPTION') {
      // <Option> has low entropy in charset + text length, so use `CENSORED_STRING_MARK` when masked
      textContent = CENSORED_STRING_MARK
    } else {
      textContent = censorText(textContent)
    }
  }
  //   else if (isStyle && textContent) {
  //     try {
  //       // try to read style sheet
  //       if (textNode.nextSibling || textNode.previousSibling) {
  //         // This is not the only child of the stylesheet.
  //         // We can't read all of the sheet's .cssRules and expect them
  //         // to _only_ include the current rule(s) added by the text node.
  //         // So we'll be conservative and keep textContent as-is.
  //       } else if (
  //         textNode.parentNode &&
  //         textNode.parentNode.sheet &&
  //         textNode.parentNode.sheet.cssRules
  //       ) {
  //         textContent = getCssRulesString(textNode.parentNode.sheet)
  //       }
  //     } catch (err) {}
  //     textContent = switchToAbsoluteUrl(textContent, getHref())
  //   }
  return textContent
}

/**
 * We don't need this logic on the recorder side.
 * For security related meta's, customer can mask themmanually given they
 * are easy to identify in the HEAD tag.
 */
export function shouldIgnoreElement(element) {
  if (element.nodeName === 'SCRIPT') {
    return true
  }

  if (element.nodeName === 'LINK') {
    var relAttribute = getLowerCaseAttribute('rel')
    return (
      // Link as script - Ignore only when rel=preload, modulepreload or prefetch
      (/preload|prefetch/i.test(relAttribute) &&
        getLowerCaseAttribute('as') === 'script') ||
      // Favicons
      relAttribute === 'shortcut icon' ||
      relAttribute === 'icon'
    )
  }

  if (element.nodeName === 'META') {
    var nameAttribute = getLowerCaseAttribute('name')
    var relAttribute = getLowerCaseAttribute('rel')
    var propertyAttribute = getLowerCaseAttribute('property')
    return (
      // Favicons
      /^msapplication-tile(image|color)$/.test(nameAttribute) ||
      nameAttribute === 'application-name' ||
      relAttribute === 'icon' ||
      relAttribute === 'apple-touch-icon' ||
      relAttribute === 'shortcut icon' ||
      // Description
      nameAttribute === 'keywords' ||
      nameAttribute === 'description' ||
      // Social
      /^(og|twitter|fb):/.test(propertyAttribute) ||
      /^(og|twitter):/.test(nameAttribute) ||
      nameAttribute === 'pinterest' ||
      // Robots
      nameAttribute === 'robots' ||
      nameAttribute === 'googlebot' ||
      nameAttribute === 'bingbot' ||
      // Http headers. Ex: X-UA-Compatible, Content-Type, Content-Language, cache-control,
      // X-Translated-By
      element.hasAttribute('http-equiv') ||
      // Authorship
      nameAttribute === 'author' ||
      nameAttribute === 'generator' ||
      nameAttribute === 'framework' ||
      nameAttribute === 'publisher' ||
      nameAttribute === 'progid' ||
      /^article:/.test(propertyAttribute) ||
      /^product:/.test(propertyAttribute) ||
      // Verification
      nameAttribute === 'google-site-verification' ||
      nameAttribute === 'yandex-verification' ||
      nameAttribute === 'csrf-token' ||
      nameAttribute === 'p:domain_verify' ||
      nameAttribute === 'verify-v1' ||
      nameAttribute === 'verification' ||
      nameAttribute === 'shopify-checkout-api-token'
    )
  }

  function getLowerCaseAttribute(name) {
    return (element.getAttribute(name) || '').toLowerCase()
  }

  return false
}
