import { ConsoleApiName } from '../helper/display'
import {
  toStackTraceString,
  NO_ERROR_STACK_PRESENT_MESSAGE
} from '../helper/errorTools'
import { createBoundedBuffer } from '../helper/boundedBuffer'
import { computeStackTrace } from '../tracekit'
import { Observable } from '../helper/observable'
import { getConnectivity } from '../helper/connectivity'
import {
  displayIfDebugEnabled,
  startMonitorErrorCollection
} from '..//helper/monitor'
import {
  startsWith,
  assign,
  performDraw,
  timeStampNow,
  extend2Lev
} from '../helper/tools'
import { jsonStringify } from '../helper/serialisation/jsonStringify'
import { NonErrorPrefix } from '../helper/enums'
import { TelemetryStatusType, TelemetryType } from './types'

const ALLOWED_FRAME_URLS = [
  'https://static.guance.com',
  'http://localhost',
  '<anonymous>'
]

export var TelemetryService = {
  LOGS: 'browser-logs-sdk',
  RUM: 'browser-rum-sdk'
}

// eslint-disable-next-line local-rules/disallow-side-effects
var preStartTelemetryBuffer = createBoundedBuffer()
var onRawTelemetryEventCollected = function (event) {
  preStartTelemetryBuffer.add(function () {
    onRawTelemetryEventCollected(event)
  })
}

export function startTelemetry(telemetryService, configuration) {
  let contextProvider
  var observable = new Observable()
  const alreadySentEvents = new Set()
  const telemetryEnabled =
    configuration.telemetryEnabled &&
    performDraw(configuration.telemetrySampleRate)
  const runtimeEnvInfo = getRuntimeEnvInfo()
  onRawTelemetryEventCollected = function (rawEvent) {
    const stringifiedEvent = jsonStringify(rawEvent)
    if (
      telemetryEnabled &&
      alreadySentEvents.size < configuration.maxTelemetryEventsPerPage &&
      !alreadySentEvents.has(stringifiedEvent)
    ) {
      var event = toTelemetryEvent(telemetryService, rawEvent, runtimeEnvInfo)
      observable.notify(event)
      alreadySentEvents.add(stringifiedEvent)
    }
  }
  startMonitorErrorCollection(addTelemetryError)

  function toTelemetryEvent(telemetryService, event, runtimeEnvInfo) {
    return extend2Lev(
      {
        type: 'telemetry',
        date: timeStampNow(),
        service: telemetryService,
        version: __BUILD_ENV__SDK_VERSION__,
        source: 'browser',
        telemetry: extend2Lev(event, {
          runtime_env: runtimeEnvInfo,
          connectivity: getConnectivity()
        })
      },
      contextProvider !== undefined ? contextProvider() : {}
    )
  }

  return {
    setContextProvider: function (provider) {
      contextProvider = provider
    },
    observable: observable,
    enabled: telemetryEnabled
  }
}
function getRuntimeEnvInfo() {
  return {
    is_local_file: window.location.protocol === 'file:',
    is_worker: 'WorkerGlobalScope' in self
  }
}
export function startFakeTelemetry() {
  const events = []

  onRawTelemetryEventCollected = function (event) {
    events.push(event)
  }

  return events
}
export function drainPreStartTelemetry() {
  preStartTelemetryBuffer.drain()
}
export function resetTelemetry() {
  preStartTelemetryBuffer = createBoundedBuffer()
  onRawTelemetryEventCollected = function (event) {
    preStartTelemetryBuffer.add(function () {
      onRawTelemetryEventCollected(event)
    })
  }
}

export function addTelemetryDebug(message, context) {
  displayIfDebugEnabled(message, context)
  onRawTelemetryEventCollected(
    assign(
      {
        type: TelemetryType.log,
        message: message,
        status: TelemetryStatusType.debug
      },
      context
    )
  )
}

export function addTelemetryError(e, context) {
  onRawTelemetryEventCollected(
    assign(
      {
        type: TelemetryType.log,
        status: TelemetryStatusType.error
      },
      formatError(e),
      context
    )
  )
}

export function addTelemetryConfiguration(configuration) {
  onRawTelemetryEventCollected({
    type: TelemetryType.configuration,
    configuration: configuration
  })
}

export function addTelemetryUsage(usage) {
  onRawTelemetryEventCollected({
    type: TelemetryType.usage,
    usage: usage
  })
}

export function formatError(e) {
  if (e instanceof Error) {
    var stackTrace = computeStackTrace(e)
    return {
      error: {
        kind: stackTrace.name,
        stack: toStackTraceString(scrubCustomerFrames(stackTrace))
      },
      message: stackTrace.message
    }
  }
  return {
    error: {
      stack: NO_ERROR_STACK_PRESENT_MESSAGE
    },
    message: NonErrorPrefix.UNCAUGHT + ' ' + jsonStringify(e)
  }
}

export function scrubCustomerFrames(stackTrace) {
  stackTrace.stack = stackTrace.stack.filter(function (frame) {
    return (
      !frame.url ||
      ALLOWED_FRAME_URLS.some(function (allowedFrameUrl) {
        return startsWith(frame.url, allowedFrameUrl)
      })
    )
  })
  return stackTrace
}
