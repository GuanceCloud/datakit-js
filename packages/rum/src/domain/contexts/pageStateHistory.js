import {
  elapsed,
  createValueHistory,
  SESSION_TIME_OUT_DELAY,
  toServerDuration,
  addEventListeners,
  relativeNow,
  DOM_EVENT
} from '@cloudcare/browser-core'

// Arbitrary value to cap number of element for memory consumption in the browser
export var MAX_PAGE_STATE_ENTRIES = 4000
// Arbitrary value to cap number of element for backend & to save bandwidth
export var MAX_PAGE_STATE_ENTRIES_SELECTABLE = 500

export var PAGE_STATE_CONTEXT_TIME_OUT_DELAY = SESSION_TIME_OUT_DELAY

export var PageState = {
  ACTIVE: 'active',
  PASSIVE: 'passive',
  HIDDEN: 'hidden',
  FROZEN: 'frozen',
  TERMINATED: 'terminated'
}

export function startPageStateHistory(maxPageStateEntriesSelectable) {
  if (maxPageStateEntriesSelectable === undefined) {
    maxPageStateEntriesSelectable = MAX_PAGE_STATE_ENTRIES_SELECTABLE
  }
  var pageStateEntryHistory = createValueHistory({
    expireDelay: PAGE_STATE_CONTEXT_TIME_OUT_DELAY,
    maxEntries: MAX_PAGE_STATE_ENTRIES
  })

  var currentPageState
  addPageState(getPageState(), relativeNow())

  var _addEventListeners = addEventListeners(
    window,
    [
      DOM_EVENT.PAGE_SHOW,
      DOM_EVENT.FOCUS,
      DOM_EVENT.BLUR,
      DOM_EVENT.VISIBILITY_CHANGE,
      DOM_EVENT.RESUME,
      DOM_EVENT.FREEZE,
      DOM_EVENT.PAGE_HIDE
    ],
    function (event) {
      // Only get events fired by the browser to avoid false currentPageState changes done with custom events
      addPageState(computePageState(event), event.timeStamp)
    },
    { capture: true }
  )
  var stopEventListeners = _addEventListeners.stop

  function addPageState(nextPageState, startTime) {
    if (startTime === undefined) {
      startTime = relativeNow()
    }
    if (nextPageState === currentPageState) {
      return
    }

    currentPageState = nextPageState
    pageStateEntryHistory.closeActive(startTime)
    pageStateEntryHistory.add(
      { state: currentPageState, startTime: startTime },
      startTime
    )
  }

  const pageStateHistory = {
    findAll: function (eventStartTime, duration) {
      var pageStateEntries = pageStateEntryHistory.findAll(
        eventStartTime,
        duration
      )

      if (pageStateEntries.length === 0) {
        return
      }

      var pageStateServerEntries = []
      // limit the number of entries to return
      var limit = Math.max(
        0,
        pageStateEntries.length - maxPageStateEntriesSelectable
      )

      // loop page state entries backward to return the selected ones in desc order
      for (var index = pageStateEntries.length - 1; index >= limit; index--) {
        var pageState = pageStateEntries[index]
        // compute the start time relative to the event start time (ex: to be relative to the view start time)
        var relativeStartTime = elapsed(eventStartTime, pageState.startTime)

        pageStateServerEntries.push({
          state: pageState.state,
          start: toServerDuration(relativeStartTime)
        })
      }

      return pageStateServerEntries
    },

    wasInPageStateAt: function (state, startTime) {
      return pageStateHistory.wasInPageStateDuringPeriod(state, startTime, 0)
    },

    wasInPageStateDuringPeriod: function (state, startTime, duration) {
      return pageStateEntryHistory
        .findAll(startTime, duration)
        .some(function (pageState) {
          return pageState.state === state
        })
    },

    addPageState: addPageState,
    stop: function () {
      stopEventListeners()
      pageStateEntryHistory.stop()
    }
  }
  return pageStateHistory
}

function computePageState(event) {
  if (event.type === DOM_EVENT.FREEZE) {
    return PageState.FROZEN
  } else if (event.type === DOM_EVENT.PAGE_HIDE) {
    return event.persisted ? PageState.FROZEN : PageState.TERMINATED
  }
  return getPageState()
}

function getPageState() {
  if (document.visibilityState === 'hidden') {
    return PageState.HIDDEN
  }

  if (document.hasFocus()) {
    return PageState.ACTIVE
  }

  return PageState.PASSIVE
}
