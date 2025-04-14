import {
  SESSION_TIME_OUT_DELAY,
  createValueHistory,
  LifeCycleEventType
} from '@cloudcare/browser-core'

export var VIEW_CONTEXT_TIME_OUT_DELAY = SESSION_TIME_OUT_DELAY

export function startViewContexts(lifeCycle) {
  var viewContextHistory = createValueHistory({
    expireDelay: VIEW_CONTEXT_TIME_OUT_DELAY
  })

  lifeCycle.subscribe(LifeCycleEventType.BEFORE_VIEW_CREATED, function (view) {
    viewContextHistory.add(buildViewContext(view), view.startClocks.relative)
  })

  lifeCycle.subscribe(LifeCycleEventType.AFTER_VIEW_ENDED, function (data) {
    viewContextHistory.closeActive(data.endClocks.relative)
  })
  lifeCycle.subscribe(LifeCycleEventType.BEFORE_VIEW_UPDATED, (viewUpdate) => {
    const currentView = viewContextHistory.find(viewUpdate.startClocks.relative)
    if (currentView && viewUpdate.name) {
      currentView.name = viewUpdate.name
    }
    if (currentView && viewUpdate.context) {
      currentView.context = viewUpdate.context
    }
  })
  lifeCycle.subscribe(LifeCycleEventType.SESSION_RENEWED, function () {
    viewContextHistory.reset()
  })

  function buildViewContext(view) {
    return {
      service: view.service,
      version: view.version,
      context: view.context,
      id: view.id,
      name: view.name,
      startClocks: view.startClocks
    }
  }

  return {
    findView: function (startTime) {
      return viewContextHistory.find(startTime)
    },
    stop: function () {
      viewContextHistory.stop()
    }
  }
}
