import { cssEscape, isNodeShadowRoot } from '@cloudcare/browser-core'
import { DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE } from './getActionNameFromElement'

/**
 * Internal marker used to represent a shadow root boundary. This is not a valid CSS selector and
 * needs to be split before querying each successive shadow root.
 */
export var SHADOW_DOM_MARKER = '::shadow '
/**
 * Stable attributes are attributes that are commonly used to identify parts of a UI (ex:
 * component). Those attribute values should not be generated randomly (hardcoded most of the time)
 * and stay the same across deploys. They are not necessarily unique across the document.
 */
export var STABLE_ATTRIBUTES = [
  DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE,
  // Common test attributes (list provided by google recorder)
  'data-testid',
  'data-test',
  'data-qa',
  'data-cy',
  'data-test-id',
  'data-qa-id',
  'data-testing',
  // FullStory decorator attributes:
  'data-component',
  'data-element',
  'data-source-file'
]
// Selectors to use if they target a single element on the whole document. Those selectors are
// considered as "stable" and uniquely identify an element regardless of the page state. If we find
// one, we should consider the selector "complete" and stop iterating over ancestors.
var GLOBALLY_UNIQUE_SELECTOR_GETTERS = [
  getStableAttributeSelector,
  getIDSelector
]

// Selectors to use if they target a single element among an element descendants. Those selectors
// are more brittle than "globally unique" selectors and should be combined with ancestor selectors
// to improve specificity.
var UNIQUE_AMONG_CHILDREN_SELECTOR_GETTERS = [
  getStableAttributeSelector,
  getClassSelector,
  getTagNameSelector
]

export function getSelectorFromElement(targetElement, actionNameAttribute) {
  if (!isConnected(targetElement)) {
    // We cannot compute a selector for a detached element, as we don't have access to all of its
    // parents, and we cannot determine if it's unique in the document.
    return
  }

  var subtrees = getAllSubtreeTargets(targetElement)
  var selectorParts = []
  for (var index = 0; index < subtrees.length; index += 1) {
    var subtree = subtrees[index]
    var selector = getSelectorFromElementWithinSubtree(
      subtree.target,
      subtree.rootNode,
      actionNameAttribute
    )
    if (!selector) {
      return
    }
    selectorParts.push(selector)
  }
  return selectorParts.join(SHADOW_DOM_MARKER)
}

/**
 * Return each root and target pair from the document down to the target element.
 */
function getAllSubtreeTargets(element) {
  var result = []
  var currentTarget = element
  while (currentTarget) {
    var rootNode =
      typeof currentTarget.getRootNode === 'function'
        ? currentTarget.getRootNode()
        : currentTarget.ownerDocument
    result.push({ rootNode: rootNode, target: currentTarget })
    if (isNodeShadowRoot(rootNode)) {
      currentTarget = rootNode.host
    } else {
      break
    }
  }
  return result.reverse()
}

function getSelectorFromElementWithinSubtree(
  targetElement,
  rootNode,
  actionNameAttribute
) {
  var targetElementSelector
  var currentElement = targetElement
  while (currentElement && currentElement.nodeName !== 'HTML') {
    const globallyUniqueSelector = findSelector(
      currentElement,
      rootNode,
      GLOBALLY_UNIQUE_SELECTOR_GETTERS,
      isSelectorUniqueWithinRoot,
      actionNameAttribute,
      targetElementSelector
    )
    if (globallyUniqueSelector) {
      return globallyUniqueSelector
    }
    const uniqueSelectorAmongChildren = findSelector(
      currentElement,
      rootNode,
      UNIQUE_AMONG_CHILDREN_SELECTOR_GETTERS,
      isSelectorUniqueAmongSiblings,
      actionNameAttribute,
      targetElementSelector
    )
    targetElementSelector =
      uniqueSelectorAmongChildren ||
      combineSelector(
        getPositionSelector(currentElement),
        targetElementSelector
      )

    currentElement = currentElement.parentElement
  }
  return targetElementSelector
}
function isGeneratedValue(value) {
  // To compute the "URL path group", the backend replaces every URL path parts as a question mark
  // if it thinks the part is an identifier. The condition it uses is to checks whether a digit is
  // present.
  //
  // Here, we use the same strategy: if a the value contains a digit, we consider it generated. This
  // strategy might be a bit naive and fail in some cases, but there are many fallbacks to generate
  // CSS selectors so it should be fine most of the time. We might want to allow customers to
  // provide their own `isGeneratedValue` at some point.
  return /[0-9]/.test(value)
}
function getIDSelector(element) {
  if (element.id && !isGeneratedValue(element.id)) {
    return '#' + cssEscape(element.id)
  }
}

function getClassSelector(element) {
  if (element.tagName === 'BODY') {
    return
  }
  if (element.classList.length > 0) {
    for (var i = 0; i < element.classList.length; i += 1) {
      var className = element.classList[i]
      if (isGeneratedValue(className)) {
        continue
      }

      return cssEscape(element.tagName) + '.' + cssEscape(className)
    }
  }
}
function getTagNameSelector(element) {
  return cssEscape(element.tagName)
}
function getStableAttributeSelector(element, actionNameAttribute) {
  if (actionNameAttribute) {
    var selector = getAttributeSelector(actionNameAttribute)
    if (selector) {
      return selector
    }
  }

  for (var i = 0; i < STABLE_ATTRIBUTES.length; i++) {
    var attributeName = STABLE_ATTRIBUTES[i]
    var selector = getAttributeSelector(attributeName)
    if (selector) {
      return selector
    }
  }

  function getAttributeSelector(attributeName) {
    if (element.hasAttribute(attributeName)) {
      return (
        cssEscape(element.tagName) +
        '[' +
        attributeName +
        '="' +
        cssEscape(element.getAttribute(attributeName)) +
        '"]'
      )
    }
  }
}

function getPositionSelector(element) {
  var parentNode = element.parentNode
  var sibling = parentNode && parentNode.firstElementChild
  var elementIndex = 1

  while (sibling && sibling !== element) {
    if (sibling.tagName === element.tagName) {
      elementIndex += 1
    }
    sibling = sibling.nextElementSibling
  }
  var tagName = cssEscape(element.tagName)
  if (/^::/.test(tagName)) {
    return tagName
  }
  return tagName + ':nth-of-type(' + elementIndex + ')'
}

function findSelector(
  element,
  rootNode,
  selectorGetters,
  predicate,
  actionNameAttribute,
  childSelector
) {
  for (var i = 0; i < selectorGetters.length; i++) {
    var selectorGetter = selectorGetters[i]
    var elementSelector = selectorGetter(element, actionNameAttribute)
    if (!elementSelector) {
      continue
    }
    if (predicate(element, rootNode, elementSelector, childSelector)) {
      return combineSelector(elementSelector, childSelector)
    }
  }
}

function isSelectorUniqueWithinRoot(
  element,
  rootNode,
  elementSelector,
  childSelector
) {
  return (
    rootNode.querySelectorAll(
      combineSelector(elementSelector, childSelector)
    ).length === 1
  )
}
/**
 * Check whether the selector is unique among the element siblings. In other words, it returns true
 * if "ELEMENT_PARENT > SELECTOR" returns a single element.
 *
 * The result will be less accurate on browsers that don't support :scope (i. e. IE): it will check
 * for any element matching the selector contained in the parent (in other words,
 * "ELEMENT_PARENT SELECTOR" returns a single element), regardless of whether the selector is a
 * direct descendent of the element parent. This should not impact results too much: if it
 * inaccurately returns false, we'll just fall back to another strategy.
 */
function isSelectorUniqueAmongSiblings(
  currentElement,
  rootNode,
  currentElementSelector,
  childSelector
) {
  let isSiblingMatching

  if (childSelector === undefined) {
    // If the child selector is undefined (meaning `currentElement` is the target element, not one
    // of its ancestor), we need to use `matches` to check if the sibling is matching the selector,
    // as `querySelector` only returns a descendant of the element.
    isSiblingMatching = (sibling) => sibling.matches(currentElementSelector)
  } else {
    const scopedSelector = supportScopeSelector()
      ? combineSelector(`${currentElementSelector}:scope`, childSelector)
      : combineSelector(currentElementSelector, childSelector)
    isSiblingMatching = (sibling) =>
      sibling.querySelector(scopedSelector) !== null
  }

  let sibling = currentElement.previousElementSibling
  while (sibling) {
    if (isSiblingMatching(sibling)) {
      return false
    }
    sibling = sibling.previousElementSibling
  }

  sibling = currentElement.nextElementSibling
  while (sibling) {
    if (isSiblingMatching(sibling)) {
      return false
    }
    sibling = sibling.nextElementSibling
  }

  return true
}
function combineSelector(parent, child) {
  return child ? parent + '>' + child : parent
}
var supportScopeSelectorCache
export function supportScopeSelector() {
  if (supportScopeSelectorCache === undefined) {
    try {
      document.querySelector(':scope')
      supportScopeSelectorCache = true
    } catch {
      supportScopeSelectorCache = false
    }
  }
  return supportScopeSelectorCache
}

/**
 * Polyfill-utility for the `isConnected` property not supported in IE11
 */
function isConnected(element) {
  if (
    'isConnected' in element
    // cast is to make sure `element` is not inferred as `never` after the check
  ) {
    return element.isConnected
  }
  return element.ownerDocument.documentElement.contains(element)
}
