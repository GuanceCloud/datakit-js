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
    getCapabilities() {
      return JSON.parse(
        (eventBridgeGlobal.getCapabilities &&
          eventBridgeGlobal.getCapabilities()) ||
          '[]'
      )
    },
    getPrivacyLevel() {
      return (
        eventBridgeGlobal.getPrivacyLevel && eventBridgeGlobal.getPrivacyLevel()
      )
    },
    getAllowedWebViewHosts() {
      return JSON.parse(
        (eventBridgeGlobal.getAllowedWebViewHosts &&
          eventBridgeGlobal.getAllowedWebViewHosts()) ||
          '[]'
      )
    },
    send(eventType, event, viewId) {
      const view = viewId ? { id: viewId } : undefined
      try {
        eventBridgeGlobal.sendEvent(
          JSON.stringify({ name: eventType, data: event, view })
        )
      } catch (e) {
        // unload postmessage error
      }
    }
  }
}
export const BridgeCapability = {
  RECORDS: 'records'
}
export function bridgeSupports(capability) {
  const bridge = getEventBridge()

  return !!bridge && bridge.getCapabilities().includes(capability)
}
export function canUseEventBridge(
  currentHost = getGlobalObject().location?.hostname
) {
  const eventBridgeGlobal = getEventBridgeGlobal()
  if (
    eventBridgeGlobal &&
    eventBridgeGlobal.getAllowedWebViewHosts === undefined
  ) {
    return true
  }
  if (
    eventBridgeGlobal &&
    eventBridgeGlobal.getAllowedWebViewHosts &&
    (eventBridgeGlobal.getAllowedWebViewHosts() === null ||
      eventBridgeGlobal.getAllowedWebViewHosts() === undefined)
  ) {
    return true
  }
  var bridge = getEventBridge()
  return (
    !!bridge &&
    bridge
      .getAllowedWebViewHosts()
      .some(
        (allowedHost) =>
          currentHost === allowedHost || currentHost.endsWith(`.${allowedHost}`)
      )
  )
}
