import { addEventListener, DOM_EVENT, each } from '@cloudcare/browser-core'

export function listenActionEvents(events) {
  var selectionEmptyAtPointerDown
  var userActivity = {
    selection: false,
    input: false,
    scroll: false
  }
  var clickContext
  var listeners = [
    addEventListener(
      window,
      DOM_EVENT.POINTER_DOWN,
      function (event) {
        if (isValidPointerEvent(event)) {
          selectionEmptyAtPointerDown = isSelectionEmpty()
          userActivity = {
            selection: false,
            input: false,
            scroll: false
          }
          clickContext = events.onPointerDown(event)
        }
      },
      { capture: true }
    ),

    addEventListener(
      window,
      DOM_EVENT.SELECTION_CHANGE,
      function () {
        if (!selectionEmptyAtPointerDown || !isSelectionEmpty()) {
          userActivity.selection = true
        }
      },
      { capture: true }
    ),

    addEventListener(
      window,
      DOM_EVENT.POINTER_UP,
      function (event) {
        if (isValidPointerEvent(event) && clickContext) {
          // Use a scoped variable to make sure the value is not changed by other clicks
          var localUserActivity = userActivity
          events.onPointerUp(clickContext, event, function () {
            return localUserActivity
          })
          clickContext = undefined
        }
      },
      { capture: true }
    ),
    addEventListener(
      window,
      DOM_EVENT.SCROLL,
      function () {
        userActivity.scroll = true
      },
      { capture: true, passive: true }
    ),
    addEventListener(
      window,
      DOM_EVENT.INPUT,
      function () {
        userActivity.input = true
      },
      { capture: true }
    )
  ]

  return {
    stop: function () {
      each(listeners, function (listener) {
        return listener.stop()
      })
    }
  }
}

function isSelectionEmpty() {
  var selection = window.getSelection()
  return !selection || selection.isCollapsed
}
function isValidPointerEvent(event) {
  return (
    event.target instanceof Element &&
    // Only consider 'primary' pointer events for now. Multi-touch support could be implemented in
    // the future.
    event.isPrimary !== false
  )
}
