import {
  LifeCycle,
  createPageExitObservable,
  willSyntheticsInjectRum,
  startTelemetry,
  startBatchWithReplica,
  canUseEventBridge,
  TelemetryService,
  drainPreStartTelemetry,
  createIdentityEncoder,
  addTelemetryConfiguration,
  deepClone
} from '@cloudcare/browser-core'
import {
  startLogsSessionManager,
  startLogsSessionManagerStub
} from '../domain/logsSessionManager'
import { startLogsAssembly, getRUMInternalContext } from '../domain/assembly'
import { startConsoleCollection } from '../domain/logsCollection/console/consoleCollection'
import { startReportCollection } from '../domain/logsCollection/report/reportCollection'
import { startNetworkErrorCollection } from '../domain/logsCollection/networkError/networkErrorCollection'
import { startRuntimeErrorCollection } from '../domain/logsCollection/rumtimeError/runtimeErrorCollection'
import { startLoggerCollection } from '../domain/logsCollection/logger/loggerCollection'
import { startLogsBatch } from '../transport/startLogsBatch'
import { startInternalContext } from '../domain/contexts/internalContext'
import { startReportError } from '../domain/reportError'
import { startLogsBridge } from '../transport/startLogsBridge'
export function startLogs(initConfiguration, configuration, getCommonContext) {
  var lifeCycle = new LifeCycle()
  var cleanupTasks = []
  var reportError = startReportError(lifeCycle)
  var pageExitObservable = createPageExitObservable()
  var session =
    configuration.sessionStoreStrategyType &&
    !canUseEventBridge() &&
    !willSyntheticsInjectRum()
      ? startLogsSessionManager(configuration)
      : startLogsSessionManagerStub(configuration)
  const telemetry = startLogsTelemetry(
    initConfiguration,
    configuration,
    reportError,
    pageExitObservable,
    session
  )
  cleanupTasks.push(function () {
    telemetry.stop()
  })
  startNetworkErrorCollection(configuration, lifeCycle)
  startRuntimeErrorCollection(configuration, lifeCycle)
  startConsoleCollection(configuration, lifeCycle)
  startReportCollection(configuration, lifeCycle)
  var _startLoggerCollection = startLoggerCollection(lifeCycle)

  startLogsAssembly(
    session,
    configuration,
    lifeCycle,
    getCommonContext,
    reportError
  )
  if (!canUseEventBridge()) {
    var _startLogsBatch = startLogsBatch(
      configuration,
      lifeCycle,
      reportError,
      pageExitObservable,
      session
    )
    cleanupTasks.push(function () {
      _startLogsBatch.stop()
    })
  } else {
    startLogsBridge(lifeCycle)
  }

  var internalContext = startInternalContext(session)

  return {
    handleLog: _startLoggerCollection.handleLog,
    getInternalContext: internalContext.get,
    stop: function () {
      cleanupTasks.forEach(function (task) {
        task()
      })
    }
  }
}
function startLogsTelemetry(
  initConfiguration,
  configuration,
  reportError,
  pageExitObservable,
  session
) {
  const telemetry = startTelemetry(TelemetryService.LOGS, configuration)
  telemetry.setContextProvider(function () {
    var RUMInternalContext = getRUMInternalContext()
    return {
      application: {
        id:
          RUMInternalContext &&
          RUMInternalContext.application &&
          RUMInternalContext.application.id
      },
      session: {
        id: session.findTrackedSession() && session.findTrackedSession().id
      },
      view: {
        id:
          RUMInternalContext &&
          RUMInternalContext.view &&
          RUMInternalContext.view.id
      },
      action: {
        id:
          RUMInternalContext &&
          RUMInternalContext.userAction &&
          RUMInternalContext.userAction.id
      }
    }
  })
  var cleanupTasks = []
  if (!canUseEventBridge()) {
    var telemetryBatch = startBatchWithReplica(
      configuration,
      { endpoint: configuration.rumEndpoint, encoder: createIdentityEncoder() },
      reportError,
      pageExitObservable,
      session.expireObservable
    )
    cleanupTasks.push(function () {
      telemetryBatch.stop()
    })
    var telemetrySubscription = telemetry.observable.subscribe(function (
      event
    ) {
      telemetryBatch.add(event)
    })
    cleanupTasks.push(function () {
      telemetrySubscription.unsubscribe()
    })
  }
  drainPreStartTelemetry()
  addTelemetryConfiguration(deepClone(initConfiguration))
  return {
    telemetry: telemetry,
    stop: function () {
      cleanupTasks.forEach(function (task) {
        task()
      })
    }
  }
}
