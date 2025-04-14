import {
  display,
  includes,
  setTimeout,
  addEventListener,
  addTelemetryError,
  ONE_SECOND
} from '@cloudcare/browser-core'

export var INITIALIZATION_TIME_OUT_DELAY = 10 * ONE_SECOND

export function createDeflateWorker(configuration) {
  return new Worker(
    configuration.workerUrl ||
      URL.createObjectURL(new Blob([__BUILD_ENV__WORKER_STRING__]))
  )
}
/**
 * In order to be sure that the worker is correctly working, we need a round trip of
 * initialization messages, making the creation asynchronous.
 * These worker lifecycle states handle this case.
 */
export var DeflateWorkerStatus = {
  Nil: 0,
  Loading: 1,
  Error: 2,
  Initialized: 3
}

var state = { status: DeflateWorkerStatus.Nil }

export function startDeflateWorker(
  configuration,
  source,
  onInitializationFailure,
  createDeflateWorkerImpl
) {
  if (createDeflateWorkerImpl === undefined) {
    createDeflateWorkerImpl = createDeflateWorker
  }
  if (state.status === DeflateWorkerStatus.Nil) {
    doStartDeflateWorker(configuration, source, createDeflateWorkerImpl)
  }
  switch (state.status) {
    case DeflateWorkerStatus.Loading:
      state.initializationFailureCallbacks.push(onInitializationFailure)
      return state.worker
    case DeflateWorkerStatus.Initialized:
      return state.worker
  }
}

export function resetDeflateWorkerState() {
  if (
    state.status === DeflateWorkerStatus.Initialized ||
    state.status === DeflateWorkerStatus.Loading
  ) {
    state.stop()
  }
  state = { status: DeflateWorkerStatus.Nil }
}
export function getDeflateWorkerStatus() {
  return state.status
}

/**
 * Starts the deflate worker and handle messages and errors
 *
 * The spec allow browsers to handle worker errors differently:
 * - Chromium throws an exception
 * - Firefox fires an error event
 *
 * more details: https://bugzilla.mozilla.org/show_bug.cgi?id=1736865#c2
 */
export function doStartDeflateWorker(
  configuration,
  source,
  createDeflateWorkerImpl
) {
  if (createDeflateWorkerImpl === undefined) {
    createDeflateWorkerImpl = createDeflateWorker
  }
  try {
    var worker = createDeflateWorkerImpl(configuration)
    const errorListener = addEventListener(worker, 'error', function (error) {
      onError(configuration, source, error)
    })
    const messageListener = addEventListener(
      worker,
      'message',
      function (event) {
        var data = event.data
        if (data.type === 'errored') {
          onError(data.error, data.streamId)
        } else if (data.type === 'initialized') {
          onInitialized(data.version)
        }
      }
    )
    worker.postMessage({ action: 'init' })
    setTimeout(function () {
      return onTimeout(source)
    }, INITIALIZATION_TIME_OUT_DELAY)

    var stop = function () {
      errorListener.stop()
      messageListener.stop()
    }
    state = {
      status: DeflateWorkerStatus.Loading,
      worker: worker,
      stop: stop,
      initializationFailureCallbacks: []
    }
  } catch (error) {
    onError(configuration, source, error)
  }
}
function onTimeout(source) {
  if (state.status === DeflateWorkerStatus.Loading) {
    display.error(
      source +
        ' failed to start: a timeout occurred while initializing the Worker'
    )
    state.initializationFailureCallbacks.forEach(function (callback) {
      callback()
    })
    state = { status: DeflateWorkerStatus.Error }
  }
}
function onInitialized(version) {
  if (state.status === DeflateWorkerStatus.Loading) {
    state = {
      status: DeflateWorkerStatus.Initialized,
      worker: state.worker,
      version: version,
      stop: state.stop
    }
  }
}

function onError(configuration, source, error, streamId) {
  if (state.status === DeflateWorkerStatus.Loading) {
    display.error(
      source + ' failed to start: an error occurred while creating the Worker:',
      error
    )
    if (
      error instanceof Event ||
      (error instanceof Error && isMessageCspRelated(error.message))
    ) {
      let baseMessage
      if (configuration.workerUrl) {
        baseMessage =
          'Please make sure the Worker URL ' +
          configuration.workerUrl +
          ' is correct and CSP is correctly configured.'
      } else {
        baseMessage = 'Please make sure CSP is correctly configured.'
      }
      display.error(baseMessage)
    } else {
      addTelemetryError(error)
    }
    if (state.status === DeflateWorkerStatus.Loading) {
      state.initializationFailureCallbacks.forEach(function (callback) {
        callback()
      })
    }
    state = { status: DeflateWorkerStatus.Error }
  } else {
    addTelemetryError(error, {
      worker_version:
        state.status === DeflateWorkerStatus.Initialized && state.version,
      stream_id: streamId
    })
  }
}
function isMessageCspRelated(message) {
  return (
    includes(message, 'Content Security Policy') ||
    // Related to `require-trusted-types-for` CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/require-trusted-types-for
    includes(message, "requires 'TrustedScriptURL'")
  )
}
