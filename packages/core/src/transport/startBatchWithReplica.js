import { createBatch } from './batch'
import { createHttpRequest } from './httpRequest'
import { createFlushController } from './flushController'
export function startBatchWithReplica(
  configuration,
  primary,
  reportError,
  pageExitObservable,
  sessionExpireObservable,
  batchFactoryImp
) {
  if (batchFactoryImp === undefined) {
    batchFactoryImp = createBatch
  }
  var primaryBatch = createBatchFromConfig(configuration, primary)

  function createBatchFromConfig(configuration, batchConfiguration) {
    return batchFactoryImp({
      encoder: batchConfiguration.encoder,
      request: createHttpRequest(
        batchConfiguration.endpoint,
        configuration.batchBytesLimit,
        configuration.retryMaxSize,
        reportError
      ),
      flushController: createFlushController({
        messagesLimit: configuration.batchMessagesLimit,
        bytesLimit: configuration.batchBytesLimit,
        durationLimit: configuration.flushTimeout,
        pageExitObservable: pageExitObservable,
        sessionExpireObservable: sessionExpireObservable
      }),
      messageBytesLimit: configuration.messageBytesLimit,
      sendContentTypeByJson: configuration.sendContentTypeByJson
    })
  }
  return {
    flushObservable: primaryBatch.flushController.flushObservable,
    add: function (message) {
      primaryBatch.add(message)
    },
    upsert: function (message, key) {
      primaryBatch.upsert(message, key)
    },

    stop: function () {
      primaryBatch.stop()
    }
  }
}
