/**
 * Internal context keep returning v1 format
 * to not break compatibility with logs data format
 */
export function startInternalContext(applicationId, session, parentContexts) {
  return {
    get: function (startTime) {
      var viewContext = parentContexts.findView(startTime)
      if (session.isTracked() && viewContext && viewContext.session.id) {
        const actionContext = parentContexts.findAction(startTime)
        return {
          application_id: applicationId,
          session_id: viewContext.session.id,
          user_action: actionContext
            ? {
                id: actionContext.action.id
              }
            : undefined,
          view: viewContext.view
        }
      }
    }
  }
}
