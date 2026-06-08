import {
  LifeCycleEventType,
  RumEventType,
  startBatchWithReplica
} from '@cloudcare/browser-core'
import { EncoderStreamId } from '../domain/encoderStreamId'
export function startRumBatch(
  configuration,
  lifeCycle,
  telemetryEventObservable,
  reportError,
  pageExitObservable,
  sessionExpireObservable,
  createEncoder
) {
  const batch = startBatchWithReplica(
    configuration,
    {
      endpoint: configuration.rumEndpoint,
      encoder: createEncoder(EncoderStreamId.RUM)
    },
    reportError,
    pageExitObservable,
    sessionExpireObservable
  )
  lifeCycle.subscribe(
    LifeCycleEventType.RUM_EVENT_COLLECTED,
    function (serverRumEvent) {
      if (serverRumEvent.type === RumEventType.VIEW) {
        batch.upsert(serverRumEvent, serverRumEvent.view.id)
      } else {
        batch.add(serverRumEvent)
      }
    }
  )
  telemetryEventObservable.subscribe(function (event) {
    batch.add(event)
  })
  return batch
}
