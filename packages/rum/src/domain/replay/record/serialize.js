import {
  assign,
  startsWith,
  isNodeShadowRoot,
  forEachChildNodes,
  hasChildNodes,
  getParentNode
} from '@cloudcare/browser-core'
import { STABLE_ATTRIBUTES } from '../../rumEventsCollection/actions/getSelectorsFromElement'
import {
  NodePrivacyLevel,
  PRIVACY_ATTR_NAME,
  PRIVACY_ATTR_VALUE_HIDDEN,
  CENSORED_STRING_MARK,
  CENSORED_IMG_MARK
} from '../../../constants'

import { NodeType } from '../../../types'
import {
  getTextContent,
  shouldMaskNode,
  reducePrivacyLevel,
  getNodeSelfPrivacyLevel
} from './privacy'
import {
  getSerializedNodeId,
  setSerializedNodeId,
  getElementInputValue,
  getHiddenElementPlaceholderSize,
  switchToAbsoluteUrl,
  serializeStyleSheets,
  absoluteToDoc,
  getAbsoluteSrcsetString,
  isSVGElement,
  getHref,
  getCssRulesString,
  STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT
} from './serializationUtils'
import {
  isLongDataUrl,
  sanitizeDataUrl
} from '../../rumEventsCollection/resource/resourceUtils'
// Those values are the only one that can be used when inheriting privacy levels from parent to
// children during serialization, since HIDDEN and IGNORE shouldn't serialize their children. This
// ensures that no children are serialized when they shouldn't.

export var SerializationContextStatus = {
  INITIAL_FULL_SNAPSHOT: 0,
  SUBSEQUENT_FULL_SNAPSHOT: 1,
  MUTATION: 2
}

export var SERIALIZATION_MAX_SYNC_DURATION_MS = 32
export var SERIALIZATION_MAX_NODE_COUNT = 50000
export var SERIALIZATION_MAX_DEPTH = 1000
export var SERIALIZATION_MAX_STRING_LENGTH =
  STYLESHEET_SERIALIZATION_MAX_CHARACTER_COUNT
export var SERIALIZATION_MAX_ATTRIBUTE_COUNT = 1000
export var SERIALIZATION_MAX_NODE_SOURCE_LENGTH = 200000
// A full snapshot is followed by a synchronous JSON serialization before it
// enters the asynchronous encoder. Keep that unavoidable main-thread step
// well below the segment collection's 4 MiB backlog watermark.
export var SERIALIZATION_MAX_APPROX_BYTES = 1024 * 1024
var serializedNodeApproxBytes = new WeakMap()

export function serializeDocument(
  document,
  configuration,
  serializationContext
) {
  // We are sure that Documents are never ignored, so this function never returns null
  return serializeNodeWithId(document, {
    serializationContext: serializationContext,
    parentNodePrivacyLevel: configuration.defaultPrivacyLevel,
    configuration: configuration
  })
}

export function serializeNodeWithId(node, options) {
  var serializerTask = createMutationSerializerTask(node, options)
  if (!serializerTask) {
    return null
  }
  return completeSerializerTaskSynchronously(serializerTask)
    ? serializerTask.serializedNode
    : null
}

export function serializeNodeWithIdForMutation(node, options) {
  var mutationSerializerTask = createMutationSerializerTask(node, options)
  if (!mutationSerializerTask) {
    return null
  }
  return completeSerializerTaskSynchronously(mutationSerializerTask)
    ? mutationSerializerTask.serializedNode
    : null
}

export function createMutationSerializerTask(node, options) {
  var rootNodeDescription = describeSerializedNode(node, options)
  if (!rootNodeDescription) {
    return null
  }
  if (rootNodeDescription.isSerializationComplexityOverflow) {
    return createSerializationComplexityOverflowTask()
  }

  var serializedRootNode = assignSerializedNodeId(
    node,
    rootNodeDescription.serializedNode,
    options
  )
  var approxBytes = estimateSerializedNodeShallowBytes(serializedRootNode)
  serializedNodeApproxBytes.set(serializedRootNode, approxBytes)
  var stack = []

  if (
    rootNodeDescription.shouldSerializeChildren &&
    hasChildNodes(node)
  ) {
    pushChildIterator(
      node,
      serializedRootNode,
      rootNodeDescription.childNodesOptions
    )
  }

  return {
    serializedNode: serializedRootNode,
    isComplete: stack.length === 0,
    processedNodeCount: 1,
    approxBytes: approxBytes,
    advance: function (deadline, maxNodeCount, maxApproxBytes) {
      if (typeof maxNodeCount !== 'number') {
        maxNodeCount = SERIALIZATION_MAX_NODE_COUNT
      }
      if (typeof maxApproxBytes !== 'number') {
        maxApproxBytes = SERIALIZATION_MAX_APPROX_BYTES
      }
      if (
        this.approxBytes > maxApproxBytes ||
        (stack.length > 0 && this.approxBytes >= maxApproxBytes)
      ) {
        this.isComplete = false
        this.isMaxApproxBytesReached = true
        return false
      }
      while (
        stack.length &&
        this.processedNodeCount < maxNodeCount &&
        this.approxBytes < maxApproxBytes &&
        !this.isMaxDepthReached &&
        !this.isMaxNodeComplexityReached &&
        getCurrentTime() < deadline
      ) {
        var iterator = stack[stack.length - 1]
        var childNode = getNextUnprocessedChild(iterator)
        if (!childNode && iterator.shadowRoot) {
          childNode = iterator.shadowRoot
          iterator.shadowRoot = undefined
        } else if (!childNode) {
          stack.pop()
          continue
        }

        var childNodeDescription = describeSerializedNode(
          childNode,
          iterator.options
        )
        if (!childNodeDescription) {
          continue
        }
        if (childNodeDescription.isSerializationComplexityOverflow) {
          this.isMaxNodeComplexityReached = true
          break
        }

        var serializedChildNode = assignSerializedNodeId(
          childNode,
          childNodeDescription.serializedNode,
          iterator.options
        )
        this.processedNodeCount += 1
        this.approxBytes += estimateSerializedNodeShallowBytes(
          serializedChildNode
        )
        serializedNodeApproxBytes.set(
          serializedRootNode,
          this.approxBytes
        )
        iterator.parentSerializedNode.childNodes.push(serializedChildNode)

        if (
          childNodeDescription.shouldSerializeChildren &&
          hasChildNodes(childNode)
        ) {
          if (
            !pushChildIterator(
              childNode,
              serializedChildNode,
              childNodeDescription.childNodesOptions
            )
          ) {
            this.isMaxDepthReached = true
          }
        }
      }
      this.isMaxApproxBytesReached =
        this.approxBytes > maxApproxBytes ||
        (stack.length > 0 && this.approxBytes >= maxApproxBytes)
      this.isMaxNodeCountReached =
        stack.length > 0 && this.processedNodeCount >= maxNodeCount
      this.isComplete =
        stack.length === 0 &&
        !this.isMaxApproxBytesReached &&
        !this.isMaxDepthReached &&
        !this.isMaxNodeComplexityReached
      return this.isComplete
    }
  }

  function pushChildIterator(
    parentNode,
    parentSerializedNode,
    childNodesOptions
  ) {
    if (stack.length >= SERIALIZATION_MAX_DEPTH) {
      return false
    }
    stack.push({
      parentNode: parentNode,
      nextChild: parentNode.firstChild,
      lastProcessedChild: undefined,
      shadowRoot: parentNode.shadowRoot || undefined,
      options: childNodesOptions,
      parentSerializedNode: parentSerializedNode
    })
    return true
  }

  function getNextUnprocessedChild(iterator) {
    var childNode = iterator.nextChild
    if (
      (!childNode || childNode.parentNode !== iterator.parentNode) &&
      iterator.lastProcessedChild &&
      iterator.lastProcessedChild.parentNode === iterator.parentNode
    ) {
      childNode = iterator.lastProcessedChild.nextSibling
    }
    if (!childNode) {
      iterator.nextChild = undefined
      return
    }

    iterator.lastProcessedChild = childNode
    iterator.nextChild = childNode.nextSibling
    return childNode
  }
}

function createSerializationComplexityOverflowTask() {
  return {
    serializedNode: null,
    isComplete: false,
    processedNodeCount: 0,
    approxBytes: 0,
    isMaxNodeComplexityReached: true,
    advance: function () {
      return false
    }
  }
}

var SERIALIZATION_COMPLEXITY_OVERFLOW_DESCRIPTION = {
  isSerializationComplexityOverflow: true
}
var SERIALIZATION_COMPLEXITY_OVERFLOW_ATTRIBUTES = {}

function describeSerializedNode(node, options) {
  switch (node.nodeType) {
    case node.DOCUMENT_NODE:
      return describeDocumentNode(node, options)
    case node.DOCUMENT_FRAGMENT_NODE:
      return describeDocumentFragmentNode(node, options)
    case node.DOCUMENT_TYPE_NODE:
      return {
        serializedNode: serializeDocumentTypeNode(node),
        shouldSerializeChildren: false
      }
    case node.ELEMENT_NODE:
      return describeElementNode(node, options)
    case node.TEXT_NODE: {
      if (
        node.textContent &&
        node.textContent.length > SERIALIZATION_MAX_NODE_SOURCE_LENGTH
      ) {
        return SERIALIZATION_COMPLEXITY_OVERFLOW_DESCRIPTION
      }
      var serializedTextNode = serializeTextNode(node, options)
      return serializedTextNode
        ? {
            serializedNode: serializedTextNode,
            shouldSerializeChildren: false
          }
        : null
    }
    case node.CDATA_SECTION_NODE: {
      var serializedCDataNode = serializeCDataNode()
      return serializedCDataNode
        ? {
            serializedNode: serializedCDataNode,
            shouldSerializeChildren: false
          }
        : null
    }
  }
}

export function serializeDocumentNode(document, options) {
  return describeDocumentNode(document, options).serializedNode
}

function describeDocumentNode(document, options) {
  return {
    serializedNode: {
      type: NodeType.Document,
      childNodes: [],
      adoptedStyleSheets: serializeStyleSheets(document.adoptedStyleSheets)
    },
    shouldSerializeChildren: true,
    childNodesOptions: options
  }
}

function serializeDocumentTypeNode(documentType) {
  return {
    type: NodeType.DocumentType,
    name: documentType.name,
    publicId: documentType.publicId,
    systemId: documentType.systemId
  }
}

function serializeDocumentFragmentNode(element, options) {
  return describeDocumentFragmentNode(element, options).serializedNode
}

function describeDocumentFragmentNode(element, options) {
  var isShadowRoot = isNodeShadowRoot(element)
  var shouldSerializeChildren = true
  if (isShadowRoot) {
    var shadowRootsController =
      options.serializationContext.shadowRootsController
    var publicationToken = options.serializationContext.publicationToken
    var registrationResult = publicationToken
      ? shadowRootsController.addShadowRoot(element, publicationToken)
      : shadowRootsController.addShadowRoot(element)
    if (registrationResult === false) {
      return SERIALIZATION_COMPLEXITY_OVERFLOW_DESCRIPTION
    }
    // Capacity rejection is a bounded, valid degraded state. Keep an empty
    // ShadowRoot in the baseline so light-DOM fallback remains hidden, but do
    // not serialize content or adopted styles that cannot be observed later.
    shouldSerializeChildren = registrationResult !== null
  }
  return {
    serializedNode: {
      type: NodeType.DocumentFragment,
      childNodes: [],
      isShadowRoot: isShadowRoot,
      adoptedStyleSheets: isShadowRoot && shouldSerializeChildren
        ? serializeStyleSheets(element.adoptedStyleSheets)
        : undefined
    },
    shouldSerializeChildren: shouldSerializeChildren,
    childNodesOptions: options
  }
}

/**
 * Serializing Element nodes involves capturing:
 * 1. HTML ATTRIBUTES:
 * 2. JS STATE:
 * - scroll offsets
 * - Form fields (input value, checkbox checked, option selection, range)
 * - Canvas state,
 * - Media (video/audio) play mode + currentTime
 * - iframe contents
 * - webcomponents
 * 3. CUSTOM PROPERTIES:
 * - height+width for when `hidden` to cover the element
 * 4. EXCLUDED INTERACTION STATE:
 * - focus (possible, but not worth perf impact)
 * - hover (tracked only via mouse activity)
 * - fullscreen mode
 */
export function serializeElementNode(element, options) {
  var serializedNodeDescription = describeElementNode(element, options)
  return serializedNodeDescription && serializedNodeDescription.serializedNode
}

function describeElementNode(element, options) {
  var tagName = getValidTagName(element.tagName)
  var isSVG = isSVGElement(element) || undefined

  // For performance reason, we don't use getNodePrivacyLevel directly: we leverage the
  // parentNodePrivacyLevel option to avoid iterating over all parents
  var nodePrivacyLevel = reducePrivacyLevel(
    getNodeSelfPrivacyLevel(element),
    options.parentNodePrivacyLevel
  )

  if (nodePrivacyLevel === NodePrivacyLevel.HIDDEN) {
    var placeholderSize = getHiddenElementPlaceholderSize(element)
    var attributes = {
      [PRIVACY_ATTR_NAME]: PRIVACY_ATTR_VALUE_HIDDEN
    }
    if (placeholderSize.width) {
      attributes.rr_width = placeholderSize.width
    }
    if (placeholderSize.height) {
      attributes.rr_height = placeholderSize.height
    }
    return {
      serializedNode: {
        type: NodeType.Element,
        tagName: tagName,
        attributes: attributes,
        childNodes: [],
        isSVG: isSVG
      },
      shouldSerializeChildren: false
    }
  }

  // Ignore Elements like Script and some Link, Metas
  if (nodePrivacyLevel === NodePrivacyLevel.IGNORE) {
    return null
  }

  if (element.attributes.length > SERIALIZATION_MAX_ATTRIBUTE_COUNT) {
    return SERIALIZATION_COMPLEXITY_OVERFLOW_DESCRIPTION
  }

  var attributes = getAttributesForPrivacyLevel(
    element,
    nodePrivacyLevel,
    options
  )
  if (attributes === SERIALIZATION_COMPLEXITY_OVERFLOW_ATTRIBUTES) {
    return SERIALIZATION_COMPLEXITY_OVERFLOW_DESCRIPTION
  }

  var shouldSerializeChildren = false
  var childNodesSerializationOptions
  // Style children are normally replaced by the normalized `_cssText`
  // attribute. If CSSOM cannot be read, keep the original text instead of
  // emitting an empty style node and making the whole replay unstyled. An
  // oversized source cannot fit in the bounded snapshot, so keep the style
  // element itself without turning the complete replay baseline into a
  // serialization failure.
  var styleTextContent =
    tagName === 'style' ? element.textContent : undefined
  var shouldSerializeStyleFallback =
    tagName === 'style' &&
    !attributes._cssText &&
    (typeof styleTextContent !== 'string' ||
      styleTextContent.length <= SERIALIZATION_MAX_NODE_SOURCE_LENGTH)
  if (
    hasChildNodes(element) &&
    (tagName !== 'style' || shouldSerializeStyleFallback)
  ) {
    // OBJECT POOLING OPTIMIZATION:
    // We should not create a new object systematically as it could impact performances. Try to reuse
    // the same object as much as possible, and clone it only if we need to.
    var childNodesSerializationOptions
    if (
      options.parentNodePrivacyLevel === nodePrivacyLevel &&
      options.ignoreWhiteSpace === (tagName === 'head')
    ) {
      childNodesSerializationOptions = options
    } else {
      childNodesSerializationOptions = assign({}, options, {
        parentNodePrivacyLevel: nodePrivacyLevel,
        ignoreWhiteSpace: tagName === 'head'
      })
    }
    shouldSerializeChildren = true
  }

  //   if (isNodeShadowHost(element)) {
  //     var shadowRoot = serializeNodeWithId(element.shadowRoot, options)
  //     if (shadowRoot !== null) {
  //       childNodes.push(shadowRoot)
  //     }
  //   }

  return {
    serializedNode: {
      type: NodeType.Element,
      tagName: tagName,
      attributes: attributes,
      childNodes: [],
      isSVG: isSVG
    },
    shouldSerializeChildren: shouldSerializeChildren,
    childNodesOptions: childNodesSerializationOptions
  }
}

/**
 * Text Nodes are dependant on Element nodes
 * Privacy levels are set on elements so we check the parentElement of a text node
 * for privacy level.
 */
function serializeTextNode(textNode, options) {
  // The parent node may not be a html element which has a tagName attribute.
  // So just let it be undefined which is ok in this use case.
  //   var parentTagName = textNode.parentElement && textNode.parentElement.tagName
  var textContent = getTextContent(
    options.configuration,
    textNode,
    options.ignoreWhiteSpace || false,
    options.parentNodePrivacyLevel
  )
  if (textContent === undefined) {
    return
  }
  return {
    type: NodeType.Text,
    textContent: textContent
    // isStyle: parentTagName === 'STYLE' ? true : undefined
  }
}

function serializeCDataNode() {
  return {
    type: NodeType.CDATA,
    textContent: ''
  }
}

export function serializeChildNodes(node, options) {
  var result = []
  forEachChildNodes(node, function (childNode) {
    var serializerTask = createMutationSerializerTask(childNode, options)
    if (
      serializerTask &&
      completeSerializerTaskSynchronously(serializerTask)
    ) {
      result.push(serializerTask.serializedNode)
    }
  })
  return result
}

function assignSerializedNodeId(node, serializedNode, options) {
  var id = getSerializedNodeId(node) || generateNextId()
  var serializedNodeWithId = serializedNode
  serializedNodeWithId.id = id
  setSerializedNodeId(node, id)
  if (options.serializedNodeIds) {
    options.serializedNodeIds.add(id)
  }
  if (options.onSerializedNode) {
    options.onSerializedNode(node, getParentNode(node))
  }
  return serializedNodeWithId
}

function getCurrentTime() {
  if (typeof performance !== 'undefined' && performance.now) {
    return performance.now()
  }
  return Date.now()
}

function completeSerializerTaskSynchronously(serializerTask) {
  return serializerTask.advance(
    getCurrentTime() + SERIALIZATION_MAX_SYNC_DURATION_MS,
    SERIALIZATION_MAX_NODE_COUNT,
    SERIALIZATION_MAX_APPROX_BYTES
  )
}

export function getSerializedNodeApproxBytes(serializedNode) {
  return serializedNodeApproxBytes.get(serializedNode)
}

function estimateSerializedNodeShallowBytes(serializedNode) {
  var approxBytes = 2
  var pendingValues = [serializedNode]
  while (pendingValues.length) {
    var value = pendingValues.pop()
    if (typeof value === 'string') {
      approxBytes += estimateJsonStringBytes(value)
    } else if (typeof value === 'number') {
      approxBytes += 16
    } else if (typeof value === 'boolean') {
      approxBytes += 5
    } else if (value && typeof value === 'object') {
      if (Array.isArray(value)) {
        // childNodes are accounted for one node at a time by the serializer.
        if (value !== serializedNode.childNodes) {
          for (var index = 0; index < value.length; index += 1) {
            pendingValues.push(value[index])
          }
        }
        approxBytes += value.length + 2
      } else {
        Object.keys(value).forEach(function (key) {
          if (key === 'childNodes' && value === serializedNode) {
            return
          }
          approxBytes += estimateJsonStringBytes(key) + 2
          pendingValues.push(value[key])
        })
      }
    } else {
      approxBytes += 4
    }
  }
  return approxBytes
}

function estimateJsonStringBytes(value) {
  if (value.length > SERIALIZATION_MAX_STRING_LENGTH) {
    return SERIALIZATION_MAX_APPROX_BYTES + 1
  }
  var bytes = 4
  for (var index = 0; index < value.length; index += 1) {
    var characterCode = value.charCodeAt(index)
    bytes +=
      characterCode <= 0x1f ||
      characterCode === 0x22 ||
      characterCode === 0x5c
        ? 12
        : 2
  }
  return bytes
}

export function serializeAttribute(
  element,
  nodePrivacyLevel,
  attributeName,
  configuration
) {
  if (nodePrivacyLevel === NodePrivacyLevel.HIDDEN) {
    // dup condition for direct access case
    return null
  }
  var attributeValue = element.getAttribute(attributeName)
  if (
    nodePrivacyLevel === NodePrivacyLevel.MASK &&
    attributeName !== PRIVACY_ATTR_NAME &&
    !STABLE_ATTRIBUTES.includes(attributeName) &&
    attributeName !== configuration.actionNameAttribute
  ) {
    var tagName = element.tagName

    switch (attributeName) {
      // Mask Attribute text content
      case 'title':
      case 'alt':
      case 'placeholder':
        return CENSORED_STRING_MARK
    }
    // mask image URLs
    if (tagName === 'IMG' || tagName === 'SOURCE') {
      if (attributeName === 'src' || attributeName === 'srcset') {
        return CENSORED_IMG_MARK
      } else if (attributeName === 'onerror') {
        return null
      }
    }
    // mask <a> URLs
    if (tagName === 'A' && attributeName === 'href') {
      return CENSORED_STRING_MARK
    }

    // mask data-* attributes
    if (attributeValue && startsWith(attributeName, 'data-')) {
      // Exception: it's safe to reveal the `${PRIVACY_ATTR_NAME}` attr
      return CENSORED_STRING_MARK
    }
    // mask iframe srcdoc
    if (tagName === 'IFRAME' && attributeName === 'srcdoc') {
      return CENSORED_STRING_MARK
    }
  }

  if (!attributeValue || typeof attributeValue !== 'string') {
    return attributeValue
  }

  // Minimum Fix for customer.
  //   if (
  //     attributeValue.length > MAX_ATTRIBUTE_VALUE_CHAR_LENGTH &&
  //     attributeValue.slice(0, 5) === 'data:'
  //   ) {
  //     return 'data:truncated'
  //   }
  if (isLongDataUrl(attributeValue)) {
    return sanitizeDataUrl(attributeValue)
  }
  return attributeValue
}

var _nextId = 1
function generateNextId() {
  return _nextId++
}

var TAG_NAME_REGEX = /[^a-z1-6-_]/
function getValidTagName(tagName) {
  var processedTagName = (tagName + '').toLowerCase().trim()

  if (TAG_NAME_REGEX.test(processedTagName)) {
    // if the tag name is odd and we cannot extract
    // anything from the string, then we return a
    // generic div
    return 'div'
  }

  return processedTagName
}

function transformAttribute(doc, tagName, name, value) {
  if (!value) return value
  if (
    name === 'src' ||
    (name === 'href' && !(tagName === 'use' && value[0] === '#'))
  ) {
    return absoluteToDoc(doc, value)
  } else if (name === 'xlink:href' && value[0] !== '#') {
    return absoluteToDoc(doc, value)
  } else if (
    name === 'background' &&
    value &&
    (tagName === 'table' || tagName === 'td' || tagName === 'th')
  ) {
    return absoluteToDoc(doc, value)
  } else if (name === 'srcset') {
    return getAbsoluteSrcsetString(doc, value)
  } else if (name === 'style') {
    return switchToAbsoluteUrl(value, getHref())
  } else if (tagName === 'object' && name === 'data') {
    return absoluteToDoc(doc, value)
  } else {
    return value
  }
}

function getAttributesForPrivacyLevel(element, nodePrivacyLevel, options) {
  if (nodePrivacyLevel === NodePrivacyLevel.HIDDEN) {
    return {}
  }
  var safeAttrs = {}
  var tagName = getValidTagName(element.tagName)
  var doc = element.ownerDocument
  var sourceLength = 0

  for (var i = 0; i < element.attributes.length; i += 1) {
    var attribute = element.attributes.item(i)
    var attributeName = attribute.name
    sourceLength += attributeName.length + attribute.value.length
    if (sourceLength > SERIALIZATION_MAX_NODE_SOURCE_LENGTH) {
      return SERIALIZATION_COMPLEXITY_OVERFLOW_ATTRIBUTES
    }
    var attributeValue = serializeAttribute(
      element,
      nodePrivacyLevel,
      attributeName,
      options.configuration
    )
    if (attributeValue !== null) {
      safeAttrs[attributeName] = transformAttribute(
        doc,
        tagName,
        attributeName,
        attributeValue
      )
    }
  }

  if (
    element.value &&
    (tagName === 'textarea' ||
      tagName === 'select' ||
      tagName === 'option' ||
      tagName === 'input')
  ) {
    if (
      typeof element.value === 'string' &&
      sourceLength + element.value.length >
        SERIALIZATION_MAX_NODE_SOURCE_LENGTH
    ) {
      return SERIALIZATION_COMPLEXITY_OVERFLOW_ATTRIBUTES
    }
    var formValue = getElementInputValue(
      options.configuration,
      element,
      nodePrivacyLevel
    )
    if (formValue !== undefined) {
      safeAttrs.value = formValue
    }
  }

  /**
   * <Option> can be selected, which occurs if its `value` matches ancestor `<Select>.value`
   */
  if (tagName === 'option' && nodePrivacyLevel === NodePrivacyLevel.ALLOW) {
    // For privacy=`MASK`, all the values would be the same, so skip.
    var optionElement = element
    if (optionElement.selected) {
      safeAttrs.selected = optionElement.selected
    }
  }

  // remote css
  if (tagName === 'link') {
    var stylesheet = getStyleSheetByHref(
      options.serializationContext,
      doc,
      element.href
    )
    var cssText = getCssRulesString(stylesheet)
    if (cssText && stylesheet) {
      safeAttrs._cssText = cssText
    }
  }

  // dynamic stylesheet
  if (tagName === 'style' && element.sheet) {
    var cssText = getCssRulesString(element.sheet)
    if (cssText) {
      safeAttrs._cssText = cssText
    }
  }

  /**
   * Forms: input[type=checkbox,radio]
   * The `checked` property for <input> is a little bit special:
   * 1. el.checked is a setter that returns if truthy.
   * 2. getAttribute returns the string value
   * getAttribute('checked') does not sync with `Element.checked`, so use JS property
   * NOTE: `checked` property exists on `HTMLInputElement`. For serializer assumptions, we check for type=radio|check.
   */
  var inputElement = element
  if (
    tagName === 'input' &&
    (inputElement.type === 'radio' || inputElement.type === 'checkbox')
  ) {
    if (nodePrivacyLevel === NodePrivacyLevel.ALLOW) {
      safeAttrs.checked = !!inputElement.checked
    } else if (
      shouldMaskNode(options.configuration, inputElement, nodePrivacyLevel)
    ) {
      delete safeAttrs.checked
    }
  }

  /**
   * Serialize the media playback state
   */
  if (tagName === 'audio' || tagName === 'video') {
    var mediaElement = element
    safeAttrs.rr_mediaState = mediaElement.paused ? 'paused' : 'played'
  }

  /**
   * Serialize the scroll state for each element only for full snapshot
   */
  var scrollTop
  var scrollLeft
  var serializationContext = options.serializationContext
  switch (serializationContext.status) {
    case SerializationContextStatus.INITIAL_FULL_SNAPSHOT:
      scrollTop = Math.round(element.scrollTop)
      scrollLeft = Math.round(element.scrollLeft)
      if (scrollTop || scrollLeft) {
        serializationContext.elementsScrollPositions.set(element, {
          scrollTop: scrollTop,
          scrollLeft: scrollLeft
        })
      }
      break
    case SerializationContextStatus.SUBSEQUENT_FULL_SNAPSHOT:
      if (serializationContext.elementsScrollPositions.has(element)) {
        const scroll = serializationContext.elementsScrollPositions.get(element)
        scrollTop = scroll.scrollTop
        scrollLeft = scroll.scrollLeft
      }
      break
  }
  if (scrollLeft) {
    safeAttrs.rr_scrollLeft = scrollLeft
  }
  if (scrollTop) {
    safeAttrs.rr_scrollTop = scrollTop
  }

  return safeAttrs
}

function getStyleSheetByHref(serializationContext, doc, href) {
  if (!href) {
    return undefined
  }

  var styleSheetByHref = serializationContext.styleSheetByHref
  if (!styleSheetByHref) {
    styleSheetByHref = new Map()
    for (var i = 0; i < doc.styleSheets.length; i += 1) {
      var styleSheet = doc.styleSheets[i]
      if (styleSheet.href) {
        styleSheetByHref.set(styleSheet.href, styleSheet)
      }
    }
    serializationContext.styleSheetByHref = styleSheetByHref
  }

  return styleSheetByHref.get(href)
}
