import {
  display,
  includes,
  setTimeout,
  clearTimeout,
  addEventListener,
  addTelemetryError,
  ONE_SECOND
} from '@cloudcare/browser-core'

export var INITIALIZATION_TIME_OUT_DELAY = 10 * ONE_SECOND
var workerObjectUrls = new WeakMap()

export function createDeflateWorker(configuration) {
  if (configuration.workerUrl) {
    return new Worker(configuration.workerUrl)
  }

  var objectUrl = URL.createObjectURL(
    new Blob([__BUILD_ENV__WORKER_STRING__])
  )
  try {
    var worker = new Worker(objectUrl)
    workerObjectUrls.set(worker, objectUrl)
    return worker
  } catch (error) {
    URL.revokeObjectURL(objectUrl)
    throw error
  }
}

function revokeDeflateWorkerObjectUrl(worker) {
  var objectUrl = workerObjectUrls.get(worker)
  if (!objectUrl) {
    return
  }
  workerObjectUrls.delete(worker)
  URL.revokeObjectURL(objectUrl)
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

export function createDeflateWorkerController() {
  var state = { status: DeflateWorkerStatus.Nil }

  function start(
    configuration,
    source,
    onInitializationFailure,
    createDeflateWorkerImpl
  ) {
    if (!__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      createDeflateWorkerImpl = createDeflateWorker
    } else if (createDeflateWorkerImpl === undefined) {
      createDeflateWorkerImpl = createDeflateWorker
    }
    if (state.status === DeflateWorkerStatus.Nil) {
      doStart(configuration, source, createDeflateWorkerImpl)
    }
    switch (state.status) {
      case DeflateWorkerStatus.Loading:
        state.initializationFailureCallbacks.push(onInitializationFailure)
        return state.worker
      case DeflateWorkerStatus.Initialized:
        return state.worker
      case DeflateWorkerStatus.Error:
        onInitializationFailure()
        return undefined
    }
  }

  function reset() {
    if (
      state.status === DeflateWorkerStatus.Initialized ||
      state.status === DeflateWorkerStatus.Loading
    ) {
      state.stop()
    }
    state = { status: DeflateWorkerStatus.Nil }
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
  function doStart(configuration, source, createDeflateWorkerImpl) {
    if (!__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
      createDeflateWorkerImpl = createDeflateWorker
    } else if (createDeflateWorkerImpl === undefined) {
      createDeflateWorkerImpl = createDeflateWorker
    }
    try {
      var worker = createDeflateWorkerImpl(configuration)
      var errorListener
      var messageListener
      var initializationTimeoutId
      var stopped = false
      var stop = function () {
        if (stopped) {
          return
        }
        stopped = true
        if (initializationTimeoutId !== undefined) {
          clearTimeout(initializationTimeoutId)
        }
        if (errorListener) {
          errorListener.stop()
        }
        if (messageListener) {
          messageListener.stop()
        }
        if (typeof worker.terminate === 'function') {
          worker.terminate()
        }
        revokeDeflateWorkerObjectUrl(worker)
      }
      state = {
        status: DeflateWorkerStatus.Loading,
        worker: worker,
        stop: stop,
        initializationTimeoutId: undefined,
        initializationFailureCallbacks: []
      }

      errorListener = addEventListener(worker, 'error', function (error) {
        onError(configuration, source, error)
      })
      messageListener = addEventListener(
        worker,
        'message',
        function (event) {
          var data = event.data
          if (data.type === 'errored') {
            onError(configuration, source, data.error, data.streamId)
          } else if (data.type === 'initialized') {
            onInitialized(data.version)
          }
        }
      )
      initializationTimeoutId = setTimeout(function () {
        return onTimeout(source)
      }, INITIALIZATION_TIME_OUT_DELAY)
      state.initializationTimeoutId = initializationTimeoutId
      worker.postMessage({ action: 'init' })
    } catch (error) {
      onError(configuration, source, error)
    }
  }

  function onTimeout(source) {
    if (state.status === DeflateWorkerStatus.Loading) {
      const loadingState = state
      display.error(
        source +
          ' failed to start: a timeout occurred while initializing the Worker'
      )
      loadingState.stop()
      state = { status: DeflateWorkerStatus.Error }
      loadingState.initializationFailureCallbacks.forEach(function (callback) {
        callback()
      })
    }
  }

  function onInitialized(version) {
    if (state.status === DeflateWorkerStatus.Loading) {
      clearTimeout(state.initializationTimeoutId)
      revokeDeflateWorkerObjectUrl(state.worker)
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
      const loadingState = state
      display.error(
        source +
          ' failed to start: an error occurred while creating the Worker:',
        error
      )
      if (
        isWorkerErrorCspRelated(error)
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
      loadingState.stop()
      state = { status: DeflateWorkerStatus.Error }
      loadingState.initializationFailureCallbacks.forEach(function (callback) {
        callback()
      })
    } else {
      addTelemetryError(error, {
        worker_version:
          state.status === DeflateWorkerStatus.Initialized && state.version,
        stream_id: streamId
      })
      if (state.status === DeflateWorkerStatus.Nil) {
        state = { status: DeflateWorkerStatus.Error }
      }
    }
  }

  return {
    start: start,
    reset: reset,
    getStatus: function () {
      return state.status
    },
    doStart: doStart
  }
}

var sharedDeflateWorkerController = createDeflateWorkerController()

export function startDeflateWorker(
  configuration,
  source,
  onInitializationFailure,
  createDeflateWorkerImpl
) {
  return sharedDeflateWorkerController.start(
    configuration,
    source,
    onInitializationFailure,
    createDeflateWorkerImpl
  )
}

export function resetDeflateWorkerState() {
  sharedDeflateWorkerController.reset()
}

export function getDeflateWorkerStatus() {
  return sharedDeflateWorkerController.getStatus()
}

export function doStartDeflateWorker(
  configuration,
  source,
  createDeflateWorkerImpl
) {
  sharedDeflateWorkerController.doStart(
    configuration,
    source,
    createDeflateWorkerImpl
  )
}
export function isWorkerErrorCspRelated(error) {
  return (
    error instanceof Event ||
    (error instanceof Error &&
      (includes(error.message, 'Content Security Policy') ||
        // Related to `require-trusted-types-for` CSP: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Security-Policy/require-trusted-types-for
        includes(error.message, "requires 'TrustedScriptURL'")))
  )
}
