import { getGlobalObject } from '../init'

function getEventBridgeGlobal() {
  return getGlobalObject().FTWebViewJavascriptBridge
}
export function getEventBridge() {
  var eventBridgeGlobal = getEventBridgeGlobal()

  if (!eventBridgeGlobal) {
    return
  }

  return {
    send(eventType, event) {
      eventBridgeGlobal.sendEvent(
        JSON.stringify({ name: eventType, data: event })
      )
    }
  }
}
export function canUseEventBridge() {
  var bridge = getEventBridge()
  return !!bridge
}
