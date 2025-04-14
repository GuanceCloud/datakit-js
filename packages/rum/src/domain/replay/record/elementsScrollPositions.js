export function createElementsScrollPositions() {
  var scrollPositionsByElement = new WeakMap()
  return {
    set: function (element, scrollPositions) {
      if (element === document && !document.scrollingElement) {
        // cf https://drafts.csswg.org/cssom-view/#dom-document-scrollingelement,
        // in some cases scrolling elements can not be defined, we don't support those for now
        return
      }
      scrollPositionsByElement.set(
        element === document ? document.scrollingElement : element,
        scrollPositions
      )
    },
    get: function (element) {
      return scrollPositionsByElement.get(element)
    },
    has: function (element) {
      return scrollPositionsByElement.has(element)
    }
  }
}
