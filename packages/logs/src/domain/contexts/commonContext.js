export function buildCommonContext(globalContextManager, userContextManager) {
  return {
    view: {
      referrer: document.referrer,
      url: window.location.href
    },
    context: globalContextManager.getContext(),
    user: userContextManager.getContext()
  }
}
