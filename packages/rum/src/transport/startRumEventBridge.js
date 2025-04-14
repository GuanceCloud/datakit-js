import {
  getEventBridge,
  LifeCycleEventType,
  processedMessageByDataMap
} from '@cloudcare/browser-core'

export function startRumEventBridge(lifeCycle) {
  var bridge = getEventBridge()

  lifeCycle.subscribe(
    LifeCycleEventType.RUM_EVENT_COLLECTED,
    function (serverRumEvent) {
      var data = processedMessageByDataMap(serverRumEvent).rowData
      bridge.send('rum', data)
    }
  )
}
