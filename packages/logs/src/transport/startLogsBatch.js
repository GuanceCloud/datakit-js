import {
  startBatchWithReplica,
  LifeCycleEventType,
  createIdentityEncoder
} from '@cloudcare/browser-core'

export function startLogsBatch(
  configuration,
  lifeCycle,
  reportError,
  pageExitObservable,
  session
) {
  var batch = startBatchWithReplica(
    configuration,
    { endpoint: configuration.logsEndpoint, encoder: createIdentityEncoder() },
    reportError,
    pageExitObservable,
    session.expireObservable
  )

  lifeCycle.subscribe(
    LifeCycleEventType.LOG_COLLECTED,
    function (serverLogsEvent) {
      batch.add(serverLogsEvent)
    }
  )
  return batch
}
