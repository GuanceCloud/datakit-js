import { catchUserErrors } from '../helper/catchUserErrors'
import { display } from '../helper/display'
import {
  assign,
  isPercentage,
  ONE_SECOND,
  isNullUndefinedDefaultValue
} from '../helper/tools'
import { ONE_KIBI_BYTE } from '../helper/byteUtils'
import { computeTransportConfiguration } from './transportConfiguration'
import { selectSessionStoreStrategyType } from '../session/sessionStore'
export var DefaultPrivacyLevel = {
  ALLOW: 'allow',
  MASK: 'mask',
  MASK_USER_INPUT: 'mask-user-input'
}
export function validateAndBuildConfiguration(initConfiguration) {
  if (
    initConfiguration.sampleRate !== undefined &&
    !isPercentage(initConfiguration.sampleRate)
  ) {
    display.error('Sample Rate should be a number between 0 and 100')
    return
  }
  if (
    initConfiguration.sessionSampleRate !== undefined &&
    !isPercentage(initConfiguration.sessionSampleRate)
  ) {
    display.error('Sample Rate should be a number between 0 and 100')
    return
  }
  if (
    initConfiguration.telemetrySampleRate !== undefined &&
    !isPercentage(initConfiguration.telemetrySampleRate)
  ) {
    display.error('Telemetry Sample Rate should be a number between 0 and 100')
    return
  }

  var sessionSampleRate = isNullUndefinedDefaultValue(
    initConfiguration.sessionSampleRate,
    initConfiguration.sampleRate
  )
  return assign(
    {
      beforeSend:
        initConfiguration.beforeSend &&
        catchUserErrors(
          initConfiguration.beforeSend,
          'beforeSend threw an error:'
        ),
      sessionStoreStrategyType:
        selectSessionStoreStrategyType(initConfiguration),
      sessionSampleRate: isNullUndefinedDefaultValue(sessionSampleRate, 100),
      service: initConfiguration.service,
      version: initConfiguration.version,
      env: initConfiguration.env,
      telemetrySampleRate: isNullUndefinedDefaultValue(
        initConfiguration.telemetrySampleRate,
        100
      ),
      telemetryEnabled: isNullUndefinedDefaultValue(
        initConfiguration.telemetryEnabled,
        false
      ),
      silentMultipleInit: !!initConfiguration.silentMultipleInit,

      /**
       * beacon payload max queue size implementation is 64kb
       * ensure that we leave room for logs, rum and potential other users
       */
      batchBytesLimit: 16 * ONE_KIBI_BYTE,

      eventRateLimiterThreshold: 3000,
      maxTelemetryEventsPerPage: 15,

      /**
       * flush automatically, aim to be lower than ALB connection timeout
       * to maximize connection reuse.
       */
      flushTimeout: 30 * ONE_SECOND,

      /**
       * Logs intake limit
       */
      batchMessagesLimit: 50,
      messageBytesLimit: 256 * ONE_KIBI_BYTE,
      resourceUrlLimit: 5 * ONE_KIBI_BYTE,
      storeContextsToLocal: !!initConfiguration.storeContextsToLocal,
      // localstorage key ，default auto gen
      storeContextsKey: initConfiguration.storeContextsKey,
      sendContentTypeByJson: !!initConfiguration.sendContentTypeByJson,
      retryMaxSize: isNullUndefinedDefaultValue(
        initConfiguration.retryMaxSize,
        -1
      )
    },
    computeTransportConfiguration(initConfiguration)
  )
}
export function validatePostRequestRequireParamsConfiguration(
  initConfiguration
) {
  if (
    !initConfiguration.site &&
    !initConfiguration.datakitOrigin &&
    !initConfiguration.datakitUrl
  ) {
    display.error(
      'datakitOrigin or site is not configured, no RUM data will be collected.'
    )
    return false
  }
  //   if (!initConfiguration.datakitUrl && !initConfiguration.datakitOrigin) {
  //     display.error(
  //       'datakitOrigin is not configured, no RUM data will be collected.'
  //     )
  //     return false
  //   }
  if (initConfiguration.site && !initConfiguration.clientToken) {
    display.error(
      'clientToken is not configured, no RUM data will be collected.'
    )
    return false
  }
  return true
}
