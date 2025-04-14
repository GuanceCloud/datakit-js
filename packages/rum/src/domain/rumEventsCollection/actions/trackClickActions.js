import {
  timeStampNow,
  Observable,
  assign,
  getRelativeTime,
  ONE_MINUTE,
  createValueHistory,
  UUID,
  clocksNow,
  ONE_SECOND,
  elapsed,
  each,
  map,
  LifeCycleEventType,
  ActionType,
  isNullUndefinedDefaultValue,
  isArray,
  includes
} from '@cloudcare/browser-core'
import { trackEventCounts } from '../../trackEventCounts'
import {
  waitPageActivityEnd,
  PAGE_ACTIVITY_VALIDATION_DELAY
} from '../../waitPageActivityEnd'
import { createClickChain } from './clickChain'
import { getActionNameFromElement } from './getActionNameFromElement'
import { getSelectorFromElement } from './getSelectorsFromElement'
// import { getSelectorsFromElement } from './getSelectorsFromElement'
import { listenActionEvents } from './listenActionEvents'
import { computeFrustration } from './computeFrustration'
import {
  CLICK_ACTION_MAX_DURATION,
  updateInteractionSelector
} from './interactionSelectorCache'
// Maximum duration for click actions
export var ACTION_CONTEXT_TIME_OUT_DELAY = 5 * ONE_MINUTE // arbitrary

export function trackClickActions(
  lifeCycle,
  domMutationObservable,
  configuration
) {
  var history = new createValueHistory({
    expireDelay: ACTION_CONTEXT_TIME_OUT_DELAY
  })
  var stopObservable = new Observable()
  var currentClickChain

  lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, function () {
    history.reset()
  })
  lifeCycle.subscribe(LifeCycleEventType.VIEW_ENDED, stopClickChain)
  var _listenActionEvents = listenActionEvents({
    onPointerDown: function (pointerDownEvent) {
      return processPointerDown(
        configuration,
        lifeCycle,
        domMutationObservable,
        pointerDownEvent
      )
    },
    onPointerUp: function (data, startEvent, getUserActivity) {
      startClickAction(
        configuration,
        lifeCycle,
        domMutationObservable,
        history,
        stopObservable,
        appendClickToClickChain,
        data.clickActionBase,
        startEvent,
        getUserActivity,
        data.hadActivityOnPointerDown
      )
    }
  })
  var stopActionEventsListener = _listenActionEvents.stop
  var actionContexts = {
    findActionId: function (startTime) {
      const allIds = history.findAll(startTime)
      if (allIds && allIds.length) {
        return allIds[allIds.length - 1]
      }
      return undefined
    },
    findAllActionId: function (startTime) {
      return history.findAll(startTime)
    }
  }

  return {
    stop: function () {
      stopClickChain()
      stopObservable.notify()
      stopActionEventsListener()
    },
    actionContexts: actionContexts
  }

  function stopClickChain() {
    if (currentClickChain) {
      currentClickChain.stop()
    }
  }
  function appendClickToClickChain(click) {
    if (!currentClickChain || !currentClickChain.tryAppend(click)) {
      var rageClick = click.clone()
      currentClickChain = createClickChain(click, function (clicks) {
        finalizeClicks(clicks, rageClick)
      })
    }
  }
}
function processPointerDown(
  configuration,
  lifeCycle,
  domMutationObservable,
  pointerDownEvent
) {
  var clickActionBase = computeClickActionBase(
    pointerDownEvent,
    configuration.actionNameAttribute
  )

  var hadActivityOnPointerDown = false

  waitPageActivityEnd(
    lifeCycle,
    domMutationObservable,
    configuration,
    function (pageActivityEndEvent) {
      hadActivityOnPointerDown = pageActivityEndEvent.hadActivity
    },
    PAGE_ACTIVITY_VALIDATION_DELAY
  )

  return {
    clickActionBase: clickActionBase,
    hadActivityOnPointerDown: function () {
      return hadActivityOnPointerDown
    }
  }
}
function startClickAction(
  configuration,
  lifeCycle,
  domMutationObservable,
  history,
  stopObservable,
  appendClickToClickChain,
  clickActionBase,
  startEvent,
  getUserActivity,
  hadActivityOnPointerDown
) {
  var click = newClick(
    lifeCycle,
    history,
    getUserActivity,
    clickActionBase,
    startEvent
  )
  appendClickToClickChain(click)
  var selector =
    clickActionBase && clickActionBase.target && clickActionBase.target.selector
  if (selector) {
    updateInteractionSelector(startEvent.timeStamp, selector)
  }
  var _waitPageActivityEnd = waitPageActivityEnd(
    lifeCycle,
    domMutationObservable,
    configuration,
    function (pageActivityEndEvent) {
      if (
        pageActivityEndEvent.hadActivity &&
        pageActivityEndEvent.end < click.startClocks.timeStamp
      ) {
        // If the clock is looking weird, just discard the click
        click.discard()
      } else {
        if (pageActivityEndEvent.hadActivity) {
          click.stop(pageActivityEndEvent.end)
        } else if (hadActivityOnPointerDown()) {
          click.stop(
            // using the click start as activity end, so the click will have some activity but its
            // duration will be 0 (as the activity started before the click start)
            click.startClocks.timeStamp
          )
        } else {
          click.stop()
        }
      }
    },
    CLICK_ACTION_MAX_DURATION
  )
  var stopWaitPageActivityEnd = _waitPageActivityEnd.stop
  var viewEndedSubscription = lifeCycle.subscribe(
    LifeCycleEventType.VIEW_ENDED,
    function (data) {
      click.stop(data.endClocks.timeStamp)
    }
  )

  var stopSubscription = stopObservable.subscribe(function () {
    click.stop()
  })

  click.stopObservable.subscribe(function () {
    viewEndedSubscription.unsubscribe()
    stopWaitPageActivityEnd()
    stopSubscription.unsubscribe()
  })
}

function computeClickActionBase(event, actionNameAttribute) {
  var rect = event.target.getBoundingClientRect()
  var selector = getSelectorFromElement(event.target, actionNameAttribute)
  if (selector) {
    updateInteractionSelector(event.timeStamp, selector)
  }
  return {
    type: ActionType.CLICK,
    target: {
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      selector: selector
    },
    position: {
      x: Math.round(event.clientX - rect.left),
      y: Math.round(event.clientY - rect.top)
    },
    name: getActionNameFromElement(event.target, actionNameAttribute)
  }
}

var ClickStatus = {
  // Initial state, the click is still ongoing.
  ONGOING: 0,
  // The click is no more ongoing but still needs to be validated or discarded.
  STOPPED: 1,
  // Final state, the click has been stopped and validated or discarded.
  FINALIZED: 2
}

function newClick(
  lifeCycle,
  history,
  getUserActivity,
  clickActionBase,
  startEvent
) {
  var id = UUID()
  var startClocks = clocksNow()
  var historyEntry = history.add(id, startClocks.relative)
  var eventCountsSubscription = trackEventCounts({
    lifeCycle: lifeCycle,
    isChildEvent: function (event) {
      return (
        event.action !== undefined &&
        (isArray(event.action.ids)
          ? includes(event.action.ids, id)
          : event.action.ids === id)
      )
    }
  })
  var status = ClickStatus.ONGOING
  var activityEndTime
  var frustrationTypes = []
  var stopObservable = new Observable()

  function stop(newActivityEndTime) {
    if (status !== ClickStatus.ONGOING) {
      return
    }
    activityEndTime = newActivityEndTime
    status = ClickStatus.STOPPED
    if (activityEndTime) {
      historyEntry.close(getRelativeTime(activityEndTime))
    } else {
      historyEntry.remove()
    }
    eventCountsSubscription.stop()
    stopObservable.notify()
  }

  return {
    event: startEvent,
    stop: stop,
    stopObservable: stopObservable,
    hasError: function () {
      return eventCountsSubscription.eventCounts.errorCount > 0
    },
    hasPageActivity: function () {
      return activityEndTime !== undefined
    },
    getUserActivity: getUserActivity,
    addFrustration: function (frustrationType) {
      frustrationTypes.push(frustrationType)
    },
    startClocks: startClocks,
    isStopped: function () {
      return status === ClickStatus.STOPPED || status === ClickStatus.FINALIZED
    },

    clone: function () {
      return newClick(
        lifeCycle,
        history,
        getUserActivity,
        clickActionBase,
        startEvent
      )
    },

    validate: function (domEvents) {
      stop()
      if (status !== ClickStatus.STOPPED) {
        return
      }
      var _eventCountsSubscription = eventCountsSubscription.eventCounts
      var resourceCount = _eventCountsSubscription.resourceCount
      var errorCount = _eventCountsSubscription.errorCount
      var longTaskCount = _eventCountsSubscription.longTaskCount
      var clickAction = assign(
        {
          type: ActionType.CLICK,
          duration:
            activityEndTime && elapsed(startClocks.timeStamp, activityEndTime),
          startClocks: startClocks,
          id: id,
          frustrationTypes: frustrationTypes,
          counts: {
            resourceCount: resourceCount,
            errorCount: errorCount,
            longTaskCount: longTaskCount
          },
          events: isNullUndefinedDefaultValue(domEvents, [startEvent]),
          event: startEvent
        },
        clickActionBase
      )
      lifeCycle.notify(LifeCycleEventType.AUTO_ACTION_COMPLETED, clickAction)
      status = ClickStatus.FINALIZED
    },

    discard: function () {
      stop()
      status = ClickStatus.FINALIZED
    }
  }
}

export function finalizeClicks(clicks, rageClick) {
  var _computeFrustration = computeFrustration(clicks, rageClick)
  var isRage = _computeFrustration.isRage
  if (isRage) {
    each(clicks, function (click) {
      click.discard()
    })
    rageClick.stop(timeStampNow())
    rageClick.validate(
      map(clicks, function (click) {
        return click.event
      })
    )
  } else {
    rageClick.discard()
    each(clicks, function (click) {
      click.validate()
    })
  }
}
