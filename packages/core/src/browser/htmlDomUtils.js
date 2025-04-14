export function isTextNode(node) {
  return node.nodeType === Node.TEXT_NODE
}

export function isCommentNode(node) {
  return node.nodeType === Node.COMMENT_NODE
}

export function isElementNode(node) {
  return node.nodeType === Node.ELEMENT_NODE
}

export function isNodeShadowHost(node) {
  return isElementNode(node) && Boolean(node.shadowRoot)
}

export function isNodeShadowRoot(node) {
  var shadowRoot = node
  return (
    !!shadowRoot.host &&
    shadowRoot.nodeType === Node.DOCUMENT_FRAGMENT_NODE &&
    isElementNode(shadowRoot.host)
  )
}
export function hasChildNodes(node) {
  return node.childNodes.length > 0 || isNodeShadowHost(node)
}
// export function getChildNodes(node) {
//   return isNodeShadowHost(node) ? node.shadowRoot.childNodes : node.childNodes
// }
export function forEachChildNodes(node, callback) {
  // node.childNodes.forEach(callback)
  var child = node.firstChild

  while (child) {
    callback(child)
    child = child.nextSibling
  }
  if (isNodeShadowHost(node)) {
    callback(node.shadowRoot)
  }
}
/**
 * Return `host` in case if the current node is a shadow root otherwise will return the `parentNode`
 */
export function getParentNode(node) {
  return isNodeShadowRoot(node) ? node.host : node.parentNode
}
