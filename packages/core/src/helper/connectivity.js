export function getConnectivity() {
  var navigator = window.navigator
  return {
    status: navigator.onLine ? 'connected' : 'not_connected',
    interfaces:
      navigator.connection && navigator.connection.type
        ? [navigator.connection.type]
        : undefined,
    effective_type: navigator.connection?.effectiveType
  }
}
