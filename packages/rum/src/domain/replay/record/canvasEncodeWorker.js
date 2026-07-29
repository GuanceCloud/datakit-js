import {
  addTelemetryError,
  addEventListener,
  clearTimeout,
  display,
  includes,
  ONE_SECOND,
  setTimeout
} from '@cloudcare/browser-core'

export var CANVAS_WORKER_INITIALIZATION_TIME_OUT_DELAY = 10 * ONE_SECOND

export var CanvasEncodeWorkerStatus = {
  Nil: 0,
  Loading: 1,
  Error: 2,
  Initialized: 3
}

export function createCanvasEncodeWorker(
  configuration,
  workerCtor,
  urlObject
) {
  var workerUrl = configuration.replayCanvasWorkerUrl
  var usesExternalUrl = !!workerUrl

  if (!workerUrl) {
    workerUrl = urlObject.createObjectURL(
      new Blob([__BUILD_ENV__CANVAS_WORKER_STRING__])
    )
  }

  try {
    return {
      worker: new workerCtor(workerUrl),
      workerUrl: workerUrl,
      usesExternalUrl: usesExternalUrl,
      urlObject: urlObject
    }
  } catch (error) {
    if (!usesExternalUrl && typeof urlObject.revokeObjectURL === 'function') {
      urlObject.revokeObjectURL(workerUrl)
    }
    throw error
  }
}

export function createCanvasEncodeWorkerManager(configuration, options) {
  options = options || {}
  var status = CanvasEncodeWorkerStatus.Nil
  var version
  var worker
  var workerUrl
  var workerUrlObject
  var shouldRevokeWorkerUrl = false
  var initializationTimeoutId
  var initializationAttempt = 0
  var stopListeners = function () {}
  var createWorker =
    options.createWorker ||
    function () {
      return createCanvasEncodeWorker(
        configuration,
        options.Worker || globalThis.Worker,
        options.url || globalThis.URL
      )
    }
  var timeoutDelay =
    options.initializationTimeoutDelay ||
    CANVAS_WORKER_INITIALIZATION_TIME_OUT_DELAY
  var addTelemetryErrorImpl = options.addTelemetryError || addTelemetryError
  var displayError = options.displayError || display.error
  var onInitialized = options.onInitialized || function () {}
  var onError = options.onError || function () {}
  var onMessage = options.onMessage || function () {}

  function clearInitializationTimeout() {
    if (initializationTimeoutId !== undefined) {
      clearTimeout(initializationTimeoutId)
      initializationTimeoutId = undefined
    }
  }

  function revokeWorkerUrl() {
    if (
      workerUrl &&
      shouldRevokeWorkerUrl &&
      workerUrlObject &&
      typeof workerUrlObject.revokeObjectURL === 'function'
    ) {
      workerUrlObject.revokeObjectURL(workerUrl)
    }
    workerUrl = undefined
    workerUrlObject = undefined
    shouldRevokeWorkerUrl = false
  }

  function cleanup() {
    stopListeners()
    stopListeners = function () {}
    clearInitializationTimeout()
    if (worker) {
      if (typeof worker.terminate === 'function') {
        worker.terminate()
      }
      worker = undefined
    }
    revokeWorkerUrl()
  }

  function handleError(error, phase) {
    if (status === CanvasEncodeWorkerStatus.Loading) {
      displayError(
        'canvas encode worker failed to start: an error occurred while creating the Worker:',
        error
      )
      if (
        error instanceof Event ||
        (error instanceof Error && isMessageCspRelated(error.message))
      ) {
        if (configuration.replayCanvasWorkerUrl) {
          displayError(
            'Please make sure the Canvas Worker URL ' +
              configuration.replayCanvasWorkerUrl +
              ' is correct and CSP is correctly configured.'
          )
        } else {
          displayError('Please make sure CSP is correctly configured.')
        }
      } else {
        addTelemetryErrorImpl(error)
      }
      status = CanvasEncodeWorkerStatus.Error
      cleanup()
      onError(error, {
        phase: phase || 'initialization',
        deterministic:
          phase === 'initialization'
      })
      return
    }

    addTelemetryErrorImpl(error, {
      worker_version: version
    })
    onError(error, {
      phase: phase || 'runtime'
    })
  }

  return {
    ensureWorker: function () {
      if (
        status === CanvasEncodeWorkerStatus.Loading ||
        status === CanvasEncodeWorkerStatus.Initialized
      ) {
        return worker
      }
      try {
        var createdWorker = createWorker()
        var attempt = initializationAttempt + 1
        initializationAttempt = attempt
        worker = createdWorker.worker || createdWorker
        workerUrl = createdWorker.workerUrl
        workerUrlObject = createdWorker.urlObject || options.url || globalThis.URL
        shouldRevokeWorkerUrl = !!workerUrl && !createdWorker.usesExternalUrl
        status = CanvasEncodeWorkerStatus.Loading

        var errorListener = addEventListener(worker, 'error', function (event) {
          handleError(
            event.error || event || new Error('Canvas encode worker failed'),
            status === CanvasEncodeWorkerStatus.Loading ? 'initialization' : 'runtime'
          )
        })
        var messageListener = addEventListener(worker, 'message', function (event) {
          var data = event.data || {}
          if (data.action === 'initialized') {
            version = data.version
            status = CanvasEncodeWorkerStatus.Initialized
            clearInitializationTimeout()
            revokeWorkerUrl()
            onInitialized(data)
            return
          }
          onMessage(data)
        })
        stopListeners = function () {
          errorListener.stop()
          messageListener.stop()
        }

        initializationTimeoutId = setTimeout(function () {
          if (
            status === CanvasEncodeWorkerStatus.Loading &&
            initializationAttempt === attempt
          ) {
            displayError(
              'canvas encode worker failed to start: a timeout occurred while initializing the Worker'
            )
            handleError(
              new Error('Canvas encode worker initialization timeout'),
              'initialization'
            )
          }
        }, timeoutDelay)
        worker.postMessage({ action: 'init' })
      } catch (error) {
        handleError(error, 'initialization')
      }
      return worker
    },
    stop: function () {
      status = CanvasEncodeWorkerStatus.Nil
      cleanup()
    },
    getStatus: function () {
      return status
    }
  }
}

function isMessageCspRelated(message) {
  return (
    includes(message, 'Content Security Policy') ||
    includes(message, "requires 'TrustedScriptURL'")
  )
}
