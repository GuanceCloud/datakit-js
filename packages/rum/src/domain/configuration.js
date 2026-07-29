import {
  assign,
  display,
  isPercentage,
  validateAndBuildConfiguration,
  validatePostRequestRequireParamsConfiguration,
  isArray,
  TraceType,
  isNullUndefinedDefaultValue,
  DefaultPrivacyLevel,
  objectHasValue,
  isMatchOption,
  catchUserErrors,
  getOrigin,
  each,
  isNumber
} from '@cloudcare/browser-core'
import { buildEnv } from '../boot/buildEnv'
import { isTracingOption } from '../domain/tracing/tracer'

var REPLAY_CANVAS_MAX_ENCODED_BYTES = 40000
var REPLAY_CANVAS_MAX_CANVAS_SIZE = 2048

var REPLAY_CANVAS_QUALITY_PRESETS = {
  low: {
    quality: 0.25,
    sampling: 1,
    autoInterval: 1500,
    autoCooldown: 3000,
    autoUnchangedBackoff: 5000,
    autoFailureBackoff: 7000,
    autoMaxPerRun: 1
  },
  medium: {
    quality: 0.4,
    sampling: 2,
    autoInterval: 1000,
    autoCooldown: 2000,
    autoUnchangedBackoff: 3000,
    autoFailureBackoff: 5000,
    autoMaxPerRun: 2
  },
  high: {
    quality: 0.5,
    sampling: 4,
    autoInterval: 700,
    autoCooldown: 1400,
    autoUnchangedBackoff: 2000,
    autoFailureBackoff: 4000,
    autoMaxPerRun: 4
  }
}

function getReplayCanvasQualityPreset(value) {
  return typeof value === 'string'
    ? REPLAY_CANVAS_QUALITY_PRESETS[value]
    : undefined
}

export function validateAndBuildRumConfiguration(initConfiguration) {
  if (!initConfiguration.applicationId) {
    display.error(
      'Application ID is not configured, no RUM data will be collected.'
    )
    return
  }
  var requireParamsValidate =
    validatePostRequestRequireParamsConfiguration(initConfiguration)
  if (!requireParamsValidate) return
  if (
    initConfiguration.sessionOnErrorSampleRate !== undefined &&
    !isPercentage(initConfiguration.sessionOnErrorSampleRate)
  ) {
    display.error(
      'Error Session  Sample Rate should be a number between 0 and 100'
    )
    return
  }
  if (
    initConfiguration.sessionReplaySampleRate !== undefined &&
    !isPercentage(initConfiguration.sessionReplaySampleRate)
  ) {
    display.error(
      'Session Replay Sample Rate should be a number between 0 and 100'
    )
    return
  }
  if (
    initConfiguration.sessionReplayOnErrorSampleRate !== undefined &&
    !isPercentage(initConfiguration.sessionReplayOnErrorSampleRate)
  ) {
    display.error(
      'Error Session Replay Sample Rate should be a number between 0 and 100'
    )
    return
  }
  var allowedTracingUrls = validateAndBuildTracingOptions(initConfiguration)
  if (!allowedTracingUrls) {
    return
  }
  //   if (initConfiguration.allowedTracingOrigins !== undefined) {
  //     if (!isArray(initConfiguration.allowedTracingOrigins)) {
  //       display.error('Allowed Tracing Origins should be an array')
  //       return
  //     }
  //   }
  //   if (initConfiguration.allowedDDTracingOrigins !== undefined) {
  //     if (!isArray(initConfiguration.allowedDDTracingOrigins)) {
  //       display.error('Allowed Tracing Origins should be an array')
  //       return
  //     }
  //   }
  if (
    initConfiguration.tracingSampleRate !== undefined &&
    !isPercentage(initConfiguration.tracingSampleRate)
  ) {
    display.error('Tracing Sample Rate should be a number between 0 and 100')
    return
  }
  if (
    initConfiguration.excludedActivityUrls !== undefined &&
    !isArray(initConfiguration.excludedActivityUrls)
  ) {
    display.error('Excluded Activity Urls should be an array')
    return
  }
  if (
    initConfiguration.replayCanvasMode !== undefined &&
    initConfiguration.replayCanvasMode !== 'manual' &&
    initConfiguration.replayCanvasMode !== 'auto'
  ) {
    display.error("Replay Canvas Mode should be 'manual' or 'auto'")
    return
  }
  if (
    initConfiguration.replayCanvasQuality !== undefined &&
    !(
      getReplayCanvasQualityPreset(initConfiguration.replayCanvasQuality) ||
      (typeof initConfiguration.replayCanvasQuality === 'number' &&
        initConfiguration.replayCanvasQuality >= 0 &&
        initConfiguration.replayCanvasQuality <= 1)
    )
  ) {
    display.error(
      "Replay Canvas Quality should be 'low', 'medium', 'high', or a number between 0 and 1"
    )
    return
  }
  if (
    initConfiguration.replayCanvasSampling !== undefined &&
    !(
      initConfiguration.replayCanvasSampling === 'all' ||
      (isNumber(initConfiguration.replayCanvasSampling) &&
        initConfiguration.replayCanvasSampling > 0)
    )
  ) {
    display.error(
      "Replay Canvas Sampling should be 'all' or a positive number"
    )
    return
  }
  if (
    initConfiguration.replayCanvasMaxCanvasSize !== undefined &&
    (!isNumber(initConfiguration.replayCanvasMaxCanvasSize) ||
      initConfiguration.replayCanvasMaxCanvasSize <= 0)
  ) {
    display.error('Replay Canvas Max Canvas Size should be a positive number')
    return
  }
  if (
    initConfiguration.replayCanvasMaxEncodedBytes !== undefined &&
    (!isNumber(initConfiguration.replayCanvasMaxEncodedBytes) ||
      initConfiguration.replayCanvasMaxEncodedBytes <= 0)
  ) {
    display.error(
      'Replay Canvas Max Encoded Bytes should be a positive number'
    )
    return
  }
  if (
    initConfiguration.replayCanvasMaxConcurrentEncodes !== undefined &&
    (!isNumber(initConfiguration.replayCanvasMaxConcurrentEncodes) ||
      initConfiguration.replayCanvasMaxConcurrentEncodes <= 0)
  ) {
    display.error(
      'Replay Canvas Max Concurrent Encodes should be a positive number'
    )
    return
  }
  if (
    initConfiguration.replayCanvasAutoInterval !== undefined &&
    (!isNumber(initConfiguration.replayCanvasAutoInterval) ||
      initConfiguration.replayCanvasAutoInterval <= 0)
  ) {
    display.error('Replay Canvas Auto Interval should be a positive number')
    return
  }
  if (
    initConfiguration.replayCanvasAutoCooldown !== undefined &&
    (!isNumber(initConfiguration.replayCanvasAutoCooldown) ||
      initConfiguration.replayCanvasAutoCooldown <= 0)
  ) {
    display.error('Replay Canvas Auto Cooldown should be a positive number')
    return
  }
  if (
    initConfiguration.replayCanvasAutoUnchangedBackoff !== undefined &&
    (!isNumber(initConfiguration.replayCanvasAutoUnchangedBackoff) ||
      initConfiguration.replayCanvasAutoUnchangedBackoff <= 0)
  ) {
    display.error(
      'Replay Canvas Auto Unchanged Backoff should be a positive number'
    )
    return
  }
  if (
    initConfiguration.replayCanvasAutoFailureBackoff !== undefined &&
    (!isNumber(initConfiguration.replayCanvasAutoFailureBackoff) ||
      initConfiguration.replayCanvasAutoFailureBackoff <= 0)
  ) {
    display.error(
      'Replay Canvas Auto Failure Backoff should be a positive number'
    )
    return
  }
  if (
    initConfiguration.replayCanvasAutoMaxPerRun !== undefined &&
    (!isNumber(initConfiguration.replayCanvasAutoMaxPerRun) ||
      initConfiguration.replayCanvasAutoMaxPerRun <= 0)
  ) {
    display.error('Replay Canvas Auto Max Per Run should be a positive number')
    return
  }

  var baseConfiguration = validateAndBuildConfiguration(initConfiguration)
  if (!baseConfiguration) {
    return
  }
  var trackUserInteractions = !!isNullUndefinedDefaultValue(
    initConfiguration.trackUserInteractions,
    initConfiguration.trackInteractions
  )
  var replayCanvasMode = isNullUndefinedDefaultValue(
    initConfiguration.replayCanvasMode,
    'auto'
  )
  var replayCanvasQualityPreset = getReplayCanvasQualityPreset(
    initConfiguration.replayCanvasQuality
  )
  var replayCanvasSampling = initConfiguration.replayCanvasSampling
  if (replayCanvasSampling === undefined || replayCanvasSampling === null) {
    replayCanvasSampling = replayCanvasQualityPreset
      ? replayCanvasQualityPreset.sampling
      : 2
  }
  return assign(
    {
      applicationId: initConfiguration.applicationId,
      actionNameAttribute: initConfiguration.actionNameAttribute,
      sessionReplaySampleRate: isNullUndefinedDefaultValue(
        initConfiguration.sessionReplaySampleRate,
        100
      ),
      sessionOnErrorSampleRate: isNullUndefinedDefaultValue(
        initConfiguration.sessionOnErrorSampleRate,
        0
      ),
      sessionReplayOnErrorSampleRate: isNullUndefinedDefaultValue(
        initConfiguration.sessionReplayOnErrorSampleRate,
        0
      ),
      tracingSampleRate: isNullUndefinedDefaultValue(
        initConfiguration.tracingSampleRate,
        100
      ),
      allowedTracingUrls: allowedTracingUrls,
      injectTraceHeader:
        initConfiguration.injectTraceHeader &&
        catchUserErrors(
          initConfiguration.injectTraceHeader,
          'injectTraceHeader threw an error:'
        ),
      generateTraceId:
        initConfiguration.generateTraceId &&
        catchUserErrors(
          initConfiguration.generateTraceId,
          'generateTraceId threw an error:'
        ),
      excludedActivityUrls: isNullUndefinedDefaultValue(
        initConfiguration.excludedActivityUrls,
        []
      ),
      workerUrl: initConfiguration.workerUrl,
      replayCanvasWorkerUrl: initConfiguration.replayCanvasWorkerUrl,
      compressIntakeRequests: !!initConfiguration.compressIntakeRequests,
      trackUserInteractions: trackUserInteractions,
      enableLongAnimationFrame: !!initConfiguration.enableLongAnimationFrame,
      trackViewsManually: !!initConfiguration.trackViewsManually,
      replayCanvasEnabled: !!initConfiguration.replayCanvasEnabled,
      replayCanvasMode: replayCanvasMode,
      replayCanvasSampling: replayCanvasSampling,
      replayCanvasQuality: isNullUndefinedDefaultValue(
        replayCanvasQualityPreset
          ? replayCanvasQualityPreset.quality
          : initConfiguration.replayCanvasQuality,
        0.4
      ),
      replayCanvasMimeType: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasMimeType,
        'image/webp'
      ),
      replayCanvasMaxCanvasSize: Math.min(
        isNullUndefinedDefaultValue(
          initConfiguration.replayCanvasMaxCanvasSize,
          1280
        ),
        REPLAY_CANVAS_MAX_CANVAS_SIZE
      ),
      replayCanvasMaxEncodedBytes: Math.min(
        isNullUndefinedDefaultValue(
          initConfiguration.replayCanvasMaxEncodedBytes,
          REPLAY_CANVAS_MAX_ENCODED_BYTES
        ),
        REPLAY_CANVAS_MAX_ENCODED_BYTES
      ),
      replayCanvasMaxConcurrentEncodes: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasMaxConcurrentEncodes,
        1
      ),
      replayCanvasAutoInterval: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasAutoInterval,
        replayCanvasQualityPreset
          ? replayCanvasQualityPreset.autoInterval
          : 1000
      ),
      replayCanvasAutoCooldown: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasAutoCooldown,
        replayCanvasQualityPreset
          ? replayCanvasQualityPreset.autoCooldown
          : 1000
      ),
      replayCanvasAutoUnchangedBackoff: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasAutoUnchangedBackoff,
        replayCanvasQualityPreset
          ? replayCanvasQualityPreset.autoUnchangedBackoff
          : 3000
      ),
      replayCanvasAutoFailureBackoff: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasAutoFailureBackoff,
        replayCanvasQualityPreset
          ? replayCanvasQualityPreset.autoFailureBackoff
          : 5000
      ),
      replayCanvasAutoMaxPerRun: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasAutoMaxPerRun,
        replayCanvasQualityPreset
          ? replayCanvasQualityPreset.autoMaxPerRun
          : 2
      ),
      replayCanvasFlushImmediately: isNullUndefinedDefaultValue(
        initConfiguration.replayCanvasFlushImmediately,
        replayCanvasMode === 'manual'
      ),
      traceType: isNullUndefinedDefaultValue(
        initConfiguration.traceType,
        TraceType.DDTRACE
      ),
      traceId128Bit: !!initConfiguration.traceId128Bit,
      defaultPrivacyLevel: objectHasValue(
        DefaultPrivacyLevel,
        initConfiguration.defaultPrivacyLevel
      )
        ? initConfiguration.defaultPrivacyLevel
        : DefaultPrivacyLevel.MASK_USER_INPUT,
      shouldMaskNode:
        initConfiguration.shouldMaskNode &&
        catchUserErrors(
          initConfiguration.shouldMaskNode,
          'shouldMaskNode threw an error:'
        ),
      shouldRecordCanvas:
        initConfiguration.shouldRecordCanvas &&
        catchUserErrors(
          initConfiguration.shouldRecordCanvas,
          'shouldRecordCanvas threw an error:'
        )
    },
    baseConfiguration,
    buildEnv
  )
}
/**
 * Handles allowedTracingUrls and processes legacy allowedTracingOrigins
 */
function validateAndBuildTracingOptions(initConfiguration) {
  // Advise about parameters precedence.
  if (
    initConfiguration.allowedTracingUrls !== undefined &&
    initConfiguration.allowedTracingOrigins !== undefined
  ) {
    display.warn(
      'Both allowedTracingUrls and allowedTracingOrigins (deprecated) have been defined. The parameter allowedTracingUrls will override allowedTracingOrigins.'
    )
  }
  // Handle allowedTracingUrls first
  if (initConfiguration.allowedTracingUrls !== undefined) {
    if (!isArray(initConfiguration.allowedTracingUrls)) {
      display.error('Allowed Tracing URLs should be an array')
      return
    }
    // if (initConfiguration.allowedTracingUrls.length !== 0 && initConfiguration.service === undefined) {
    //   display.error('Service needs to be configured when tracing is enabled')
    //   return
    // }
    // Convert from (MatchOption | TracingOption) to TracingOption, remove unknown properties
    var tracingOptions = []
    each(initConfiguration.allowedTracingUrls, function (option) {
      if (isMatchOption(option)) {
        tracingOptions.push({
          match: option,
          traceType: isNullUndefinedDefaultValue(
            initConfiguration.traceType,
            TraceType.DDTRACE
          )
        })
      } else if (isTracingOption(option)) {
        tracingOptions.push(option)
      } else {
        display.warn(
          'Allowed Tracing Urls parameters should be a string, RegExp, function, or an object. Ignoring parameter',
          option
        )
      }
    })
    return tracingOptions
  }

  // Handle conversion of allowedTracingOrigins to allowedTracingUrls
  if (initConfiguration.allowedTracingOrigins !== undefined) {
    if (!isArray(initConfiguration.allowedTracingOrigins)) {
      display.error('Allowed Tracing Origins should be an array')
      return
    }

    var tracingOptions = []
    each(initConfiguration.allowedTracingOrigins, function (legacyMatchOption) {
      var tracingOption = convertLegacyMatchOptionToTracingOption(
        legacyMatchOption,
        isNullUndefinedDefaultValue(
          initConfiguration.traceType,
          TraceType.DDTRACE
        )
      )
      if (tracingOption) {
        tracingOptions.push(tracingOption)
      }
    })

    return tracingOptions
  }
  // Handle conversion of allowedDDTracingOrigins to allowedTracingUrls
  if (initConfiguration.allowedDDTracingOrigins !== undefined) {
    if (!isArray(initConfiguration.allowedDDTracingOrigins)) {
      display.error('Allowed Tracing Origins should be an array')
      return
    }

    var tracingOptions = []
    each(
      initConfiguration.allowedDDTracingOrigins,
      function (legacyMatchOption) {
        var tracingOption = convertLegacyMatchOptionToTracingOption(
          legacyMatchOption,
          isNullUndefinedDefaultValue(
            initConfiguration.traceType,
            TraceType.DDTRACE
          )
        )
        if (tracingOption) {
          tracingOptions.push(tracingOption)
        }
      }
    )

    return tracingOptions
  }

  return []
}

/**
 * Converts parameters from the deprecated allowedTracingOrigins
 * to allowedTracingUrls. Handles the change from origin to full URLs.
 */
function convertLegacyMatchOptionToTracingOption(item, traceType) {
  var match
  if (typeof item === 'string') {
    match = item
  } else if (item instanceof RegExp) {
    match = function (url) {
      return item.test(getOrigin(url))
    }
  } else if (typeof item === 'function') {
    match = function (url) {
      return item(getOrigin(url))
    }
  }

  if (match === undefined) {
    display.warn(
      'Allowed Tracing Origins parameters should be a string, RegExp or function. Ignoring parameter',
      item
    )
    return undefined
  }

  return { match: match, traceType: traceType }
}
