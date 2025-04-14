import { LifeCycleEventType, getEventBridge } from '@cloudcare/browser-core'
export function startLogsBridge(lifeCycle) {
  const bridge = getEventBridge()

  lifeCycle.subscribe(
    LifeCycleEventType.LOG_COLLECTED,
    function (serverLogsEvent) {
      bridge.send('log', serverLogsEvent)
    }
  )
}
