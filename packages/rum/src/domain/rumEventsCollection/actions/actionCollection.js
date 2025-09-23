import {
  toServerDuration,
  extend,
  extend2Lev,
  ActionType,
  RumEventType,
  LifeCycleEventType,
  UUID,
  noop,
  discardNegativeDuration
} from '@cloudcare/browser-core'
import { trackClickActions } from './trackClickActions'
import { PageState } from '../../contexts/pageStateHistory'
export function startActionCollection(
  lifeCycle,
  domMutationObservable,
  configuration,
  pageStateHistory
) {
  lifeCycle.subscribe(
    LifeCycleEventType.AUTO_ACTION_COMPLETED,
    function (action) {
      lifeCycle.notify(
        LifeCycleEventType.RAW_RUM_EVENT_COLLECTED,
        processAction(action, pageStateHistory)
      )
    }
  )

  var actionContexts = { findActionId: noop, findAllActionId: noop }
  if (configuration.trackUserInteractions) {
    actionContexts = trackClickActions(
      lifeCycle,
      domMutationObservable,
      configuration
    ).actionContexts
  }
  return {
    actionContexts: actionContexts,
    addAction: function (action, savedCommonContext) {
      lifeCycle.notify(
        LifeCycleEventType.RAW_RUM_EVENT_COLLECTED,
        extend(
          { savedCommonContext: savedCommonContext },
          processAction(action, pageStateHistory)
        )
      )
    }
  }
}

function processAction(action, pageStateHistory) {
  var autoActionProperties = isAutoAction(action)
    ? {
        action: {
          error: {
            count: action.counts.errorCount
          },
          id: action.id,
          loadingTime: discardNegativeDuration(
            toServerDuration(action.duration)
          ),
          frustration: {
            type: action.frustrationTypes
          },
          long_task: {
            count: action.counts.longTaskCount
          },
          resource: {
            count: action.counts.resourceCount
          }
        },
        _gc: {
          action: {
            target: action.target,
            position: action.position
          }
        }
      }
    : {
        action: {
          loadingTime: action.context?.duration || 0
        }
      }
  var customerContext = !isAutoAction(action) ? action.context : undefined
  var actionEvent = extend2Lev(
    {
      action: {
        id: UUID(),
        target: {
          name: action.name
        },
        type: action.type
      },
      date: action.startClocks.timeStamp,
      type: RumEventType.ACTION,
      view: {
        in_foreground: pageStateHistory.wasInPageStateAt(
          PageState.ACTIVE,
          action.startClocks.relative
        )
      }
    },
    autoActionProperties
  )

  return {
    customerContext: customerContext,
    rawRumEvent: actionEvent,
    startTime: action.startClocks.relative,
    domainContext: isAutoAction(action)
      ? { event: action.event, events: action.events }
      : {}
  }
}

function isAutoAction(action) {
  return action.type === ActionType.CLICK
  //   return action.type !== ActionType.CUSTOM
}
