import {
  elapsed,
  createValueHistory,
  SESSION_TIME_OUT_DELAY,
  toServerDuration,
  addEventListeners,
  relativeNow,
  DOM_EVENT
} from '@cloudcare/browser-core'
import {
  RumPerformanceEntryType,
  supportPerformanceTimingEvent
} from '../performanceObservable'
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
  if (supportPerformanceTimingEvent(RumPerformanceEntryType.VISIBILITY_STATE)) {
    const visibilityEntries = performance.getEntriesByType(
      RumPerformanceEntryType.VISIBILITY_STATE
    )

    visibilityEntries.forEach((entry) => {
      const state =
        entry.name === 'hidden' ? PageState.HIDDEN : PageState.ACTIVE
      addPageState(state, entry.startTime)
    })
  }
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
    findAll: function (startTime, duration) {
      var pageStateEntries = pageStateEntryHistory.findAll(startTime, duration)
      return processPageStates(
        pageStateEntries,
        startTime,
        maxPageStateEntriesSelectable
      )
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
function processPageStates(
  pageStateEntries,
  eventStartTime,
  maxPageStateEntriesSelectable
) {
  if (pageStateEntries.length === 0) {
    return
  }

  return pageStateEntries
    .slice(-maxPageStateEntriesSelectable)
    .reverse()
    .map(({ state, startTime }) => ({
      state,
      start: toServerDuration(elapsed(eventStartTime, startTime))
    }))
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
