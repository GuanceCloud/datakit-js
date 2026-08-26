const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// The full bundle includes DOM/Canvas 2D replay, framework plugin support,
// forced-session renewal, bridged WebView lifecycle boundaries, and the v3.3.6
// experimental WebSocket collector, including readable end-View paths, and
// Shadow DOM-aware action names and selectors.
// The optional WebGL implementation has its own package and size gate.  Keep
// this budget close to the measured base artifact, including the atomic full
// snapshot and ordered retry recovery paths, so it cannot drift back into the
// main package unnoticed.
const RUM_BUNDLE_RAW_BYTES_LIMIT = 330000
const RUM_BUNDLE_GZIP_BYTES_LIMIT = 107900
// Size-sensitive applications can use the slim package, which intentionally
// omits Session Replay.  Gate it independently so growth in the full feature
// set never weakens the lightweight distribution's contract.
const RUM_SLIM_BUNDLE_RAW_BYTES_LIMIT = 164000
const RUM_SLIM_BUNDLE_GZIP_BYTES_LIMIT = 51000
// This list mirrors the enumerable API exposed by makeRumPublicApi(),
// makeSessionReplayPublicApi(), and makePublicApi().  Keep it explicit so a
// production-only property mangle cannot silently rename a public method.
const RUM_PUBLIC_API_KEYS = [
  'addAction',
  'addDebugSession',
  'addError',
  'addResource',
  'addRumGlobalContext',
  'addTiming',
  'addTypeAction',
  'appendResourceContext',
  'clearDebugSession',
  'clearGlobalContext',
  'clearUser',
  'createResourceTrackerId',
  'finishResource',
  'flushReplayMutationsForDebug',
  'getAutoCanvasSnapshotDebugHistoryForDebug',
  'getCanvasMutationHistoryForDebug',
  'getDebugSession',
  'getDomMutationHistoryForDebug',
  'getGlobalContext',
  'getInitConfiguration',
  'getInternalContext',
  'getLastAutoCanvasSnapshotResultForDebug',
  'getLastCanvasMutationForDebug',
  'getLastDomMutationForDebug',
  'getLastReplaySegmentFlushForDebug',
  'getRemoteConfiguration',
  'getReplayPerformanceForDebug',
  'getReplaySegmentFlushHistoryForDebug',
  'getResource',
  'getRumGlobalContext',
  'getSerializedNodeIdForDebug',
  'getUser',
  'getViewContext',
  'init',
  'isRecording',
  'onReady',
  'removeGlobalContextProperty',
  'removeRumGlobalContext',
  'removeUser',
  'removeUserProperty',
  'setForcedSession',
  'setGlobalContext',
  'setGlobalContextProperty',
  'setResourceContext',
  'setRumGlobalContext',
  'setUser',
  'setUserProperty',
  'setViewContext',
  'setViewContextProperty',
  'setViewName',
  'snapshotCanvas',
  'startSession',
  'startSessionReplayRecording',
  'startView',
  'stopSession',
  'stopSessionReplayRecording',
  'takeSubsequentFullSnapshot'
]
const RUM_SLIM_PUBLIC_API_KEYS = [
  'addAction',
  'addDebugSession',
  'addError',
  'addResource',
  'addRumGlobalContext',
  'addTiming',
  'addTypeAction',
  'appendResourceContext',
  'clearDebugSession',
  'clearGlobalContext',
  'clearUser',
  'createResourceTrackerId',
  'finishResource',
  'getDebugSession',
  'getGlobalContext',
  'getInitConfiguration',
  'getInternalContext',
  'getRemoteConfiguration',
  'getResource',
  'getRumGlobalContext',
  'getUser',
  'getViewContext',
  'init',
  'onReady',
  'removeGlobalContextProperty',
  'removeRumGlobalContext',
  'removeUser',
  'removeUserProperty',
  'setForcedSession',
  'setGlobalContext',
  'setGlobalContextProperty',
  'setResourceContext',
  'setRumGlobalContext',
  'setUser',
  'setUserProperty',
  'setViewContext',
  'setViewContextProperty',
  'setViewName',
  'startSession',
  'startView',
  'stopSession'
]
const repositoryRoot = path.resolve(__dirname, '..')
const bundleProfileName = process.argv[3] || 'full'
const bundleProfile =
  bundleProfileName === 'slim'
    ? {
        label: 'RUM slim bundle',
        rawBytesLimit: RUM_SLIM_BUNDLE_RAW_BYTES_LIMIT,
        gzipBytesLimit: RUM_SLIM_BUNDLE_GZIP_BYTES_LIMIT,
        publicApiKeys: RUM_SLIM_PUBLIC_API_KEYS
      }
    : bundleProfileName === 'full'
      ? {
          label: 'RUM bundle',
          rawBytesLimit: RUM_BUNDLE_RAW_BYTES_LIMIT,
          gzipBytesLimit: RUM_BUNDLE_GZIP_BYTES_LIMIT,
          publicApiKeys: RUM_PUBLIC_API_KEYS
        }
      : fail(`Unknown bundle profile: ${bundleProfileName}`)
const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repositoryRoot, 'packages/rum/bundle/dataflux-rum.js')

if (!fs.existsSync(bundlePath)) {
  fail(`RUM bundle not found: ${bundlePath}`)
}

const publicApiResult = inspectPublicApi(
  bundlePath,
  bundleProfile.publicApiKeys
)
const rawBytes = fs.statSync(bundlePath).size
const gzipResult = spawnSync('gzip', ['-9', '-n', '-c', bundlePath], {
  encoding: null,
  maxBuffer: 5 * 1024 * 1024
})

if (gzipResult.error) {
  fail(`Unable to run deterministic gzip size check: ${gzipResult.error.message}`)
}
if (gzipResult.status !== 0) {
  fail(
    `Deterministic gzip size check failed: ${String(
      gzipResult.stderr || ''
    ).trim()}`
  )
}

const gzipBytes = gzipResult.stdout.length
console.log(
  [
    `${bundleProfile.label}: ${path.relative(repositoryRoot, bundlePath)}`,
    `public API: ${publicApiResult.apiKeyCount} methods (contract verified)`,
    `raw: ${rawBytes} / ${bundleProfile.rawBytesLimit} bytes`,
    `gzip -9 -n: ${gzipBytes} / ${bundleProfile.gzipBytesLimit} bytes`
  ].join('\n')
)

const failures = []
if (rawBytes > bundleProfile.rawBytesLimit) {
  failures.push(
    `raw size exceeds the limit by ${
      rawBytes - bundleProfile.rawBytesLimit
    } bytes`
  )
}
if (gzipBytes > bundleProfile.gzipBytesLimit) {
  failures.push(
    `gzip size exceeds the limit by ${
      gzipBytes - bundleProfile.gzipBytesLimit
    } bytes`
  )
}
if (failures.length) {
  fail(failures.join('; '))
}

function inspectPublicApi(bundlePath, expectedPublicApiKeys) {
  var previousDatafluxRum = globalThis.DATAFLUX_RUM
  var hadDatafluxRum = Object.prototype.hasOwnProperty.call(
    globalThis,
    'DATAFLUX_RUM'
  )

  try {
    delete globalThis.DATAFLUX_RUM
    delete require.cache[require.resolve(bundlePath)]
    require(bundlePath)

    var publicApi = globalThis.DATAFLUX_RUM
    if (!publicApi || typeof publicApi !== 'object') {
      throw new Error('DATAFLUX_RUM global was not created')
    }

    var actualKeys = Object.keys(publicApi).sort()
    var expectedKeys = expectedPublicApiKeys.slice().sort()
    var missingKeys = expectedKeys.filter((key) => !actualKeys.includes(key))
    var unexpectedKeys = actualKeys.filter(
      (key) => !expectedKeys.includes(key)
    )
    var nonFunctionKeys = expectedKeys.filter(
      (key) => typeof publicApi[key] !== 'function'
    )
    var failures = []

    if (missingKeys.length) {
      failures.push(`missing methods: ${missingKeys.join(', ')}`)
    }
    if (unexpectedKeys.length) {
      failures.push(`unexpected methods: ${unexpectedKeys.join(', ')}`)
    }
    if (nonFunctionKeys.length) {
      failures.push(`non-function methods: ${nonFunctionKeys.join(', ')}`)
    }
    if (typeof publicApi._setDebug !== 'function') {
      failures.push('hidden _setDebug method is missing or not a function')
    }
    if (failures.length) {
      throw new Error(failures.join('; '))
    }

    return { apiKeyCount: actualKeys.length }
  } catch (error) {
    fail(`RUM public API contract check failed: ${error.message}`)
  } finally {
    if (hadDatafluxRum) {
      globalThis.DATAFLUX_RUM = previousDatafluxRum
    } else {
      delete globalThis.DATAFLUX_RUM
    }
  }
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
