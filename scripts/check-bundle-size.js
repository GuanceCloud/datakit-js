const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// Keep measurable headroom above the accepted replay-enabled bundle after the
// bounded canvas, Shadow DOM, and synchronous page-exit reliability paths.
// This check is part of the RUM package build, so npm and OSS release paths
// cannot silently grow the browser download.  Raw and compressed budgets are
// both intentional: gzip protects transfer cost while raw protects parse cost.
const RUM_BUNDLE_RAW_BYTES_LIMIT = 338000
// Canvas/WebGL replay establishes a larger accepted production baseline.
// Keep roughly two percent of deterministic gzip headroom while the recorder
// and its workers are moved behind an optional bundle boundary.
const RUM_BUNDLE_GZIP_BYTES_LIMIT = 104000
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
  'startSessionReplayRecording',
  'startView',
  'stopSession',
  'stopSessionReplayRecording',
  'takeSubsequentFullSnapshot'
]
const repositoryRoot = path.resolve(__dirname, '..')
const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(repositoryRoot, 'packages/rum/bundle/dataflux-rum.js')

if (!fs.existsSync(bundlePath)) {
  fail(`RUM bundle not found: ${bundlePath}`)
}

const publicApiResult = inspectPublicApi(bundlePath)
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
    `RUM bundle: ${path.relative(repositoryRoot, bundlePath)}`,
    `public API: ${publicApiResult.apiKeyCount} methods (contract verified)`,
    `raw: ${rawBytes} / ${RUM_BUNDLE_RAW_BYTES_LIMIT} bytes`,
    `gzip -9 -n: ${gzipBytes} / ${RUM_BUNDLE_GZIP_BYTES_LIMIT} bytes`
  ].join('\n')
)

const failures = []
if (rawBytes > RUM_BUNDLE_RAW_BYTES_LIMIT) {
  failures.push(
    `raw size exceeds the limit by ${
      rawBytes - RUM_BUNDLE_RAW_BYTES_LIMIT
    } bytes`
  )
}
if (gzipBytes > RUM_BUNDLE_GZIP_BYTES_LIMIT) {
  failures.push(
    `gzip size exceeds the limit by ${
      gzipBytes - RUM_BUNDLE_GZIP_BYTES_LIMIT
    } bytes`
  )
}
if (failures.length) {
  fail(failures.join('; '))
}

function inspectPublicApi(bundlePath) {
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
    var expectedKeys = RUM_PUBLIC_API_KEYS.slice().sort()
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
