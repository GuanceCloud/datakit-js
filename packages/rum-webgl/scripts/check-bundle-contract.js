const fs = require('fs')
const path = require('path')

const bundlePath = path.resolve(
  __dirname,
  '../bundle/dataflux-rum-webgl.js'
)
const stableMemberKeys = [
  // Runtime registration and bridge lifecycle. The runtime factory returns a
  // positional tuple, so no factory-result property names cross bundles.
  'sessionReplayWebGL',
  'isWebGLCanvas',
  'encode',
  'encodeWithLifecycle',
  'reset',
  'stop',
  'result',
  'physicalSettled',
  // Canvas encode options and results cross the independently minified
  // addon/main-bundle boundary in both directions.
  'mimeType',
  'quality',
  'maxSize',
  'maxEncodedBytes',
  'dataUrl',
  'width',
  'height',
  'ok',
  'reason',
  // Snapshot metadata emitted by the addon and consumed by the host.
  'trigger',
  'scheduler',
  'contextType',
  // The normalized configuration object is produced by the main bundle and
  // consumed by the addon.
  'replayCanvasEnabled',
  'replayCanvasMode',
  'replayCanvasSampling',
  'replayCanvasAutoInterval',
  'replayCanvasAutoCooldown',
  'replayCanvasAutoUnchangedBackoff',
  'replayCanvasAutoFailureBackoff',
  'replayCanvasAutoMaxPerRun',
  'replayCanvasMaxConcurrentEncodes',
  'replayCanvasMimeType',
  'replayCanvasQuality',
  'replayCanvasMaxCanvasSize',
  'replayCanvasMaxEncodedBytes'
]

if (!fs.existsSync(bundlePath)) {
  fail(`WebGL addon bundle not found: ${bundlePath}`)
}

const bundleSource = fs.readFileSync(bundlePath, 'utf8')
const missingKeys = stableMemberKeys.filter(
  (key) => !bundleSource.includes(key)
)
if (missingKeys.length) {
  fail(
    `WebGL addon production bundle mangled capability keys: ${missingKeys.join(
      ', '
    )}`
  )
}

const previousAddon = globalThis.DATAFLUX_RUM_WEBGL
const hadAddon = Object.prototype.hasOwnProperty.call(
  globalThis,
  'DATAFLUX_RUM_WEBGL'
)
const previousRum = globalThis.DATAFLUX_RUM
const hadRum = Object.prototype.hasOwnProperty.call(globalThis, 'DATAFLUX_RUM')
const rumSentinel = { existingRum: true }

try {
  delete globalThis.DATAFLUX_RUM_WEBGL
  globalThis.DATAFLUX_RUM = rumSentinel
  delete require.cache[require.resolve(bundlePath)]
  require(bundlePath)

  const api = globalThis.DATAFLUX_RUM_WEBGL
  if (!api || typeof api.webglReplayPlugin !== 'function') {
    fail('DATAFLUX_RUM_WEBGL.webglReplayPlugin was not created')
  }
  if (globalThis.DATAFLUX_RUM !== rumSentinel) {
    fail('WebGL addon bundle changed DATAFLUX_RUM')
  }
  const plugin = api.webglReplayPlugin()
  const initConfiguration = { replayCanvasEnabled: false }
  if (plugin && typeof plugin.onInit === 'function') {
    plugin.onInit({ initConfiguration })
  }
  const createRuntime = initConfiguration.sessionReplayWebGL
  if (
    !plugin ||
    plugin.name !== 'session-replay-webgl' ||
    typeof createRuntime !== 'function'
  ) {
    fail('WebGL addon runtime registration contract is invalid')
  }
  const baseEncodeBridge = {
    encode: () => Promise.resolve({ ok: false, reason: 'test' }),
    encodeWithLifecycle: () => {
      const result = Promise.resolve({ ok: false, reason: 'test' })
      return { result, physicalSettled: result.then(() => {}) }
    },
    reset: () => {},
    stop: () => {}
  }
  const runtime = createRuntime(
    { replayCanvasMaxConcurrentEncodes: 1 },
    baseEncodeBridge,
    (canvas) => canvas,
    () => {}
  )
  if (
    !Array.isArray(runtime) ||
    !runtime[0] ||
    typeof runtime[0].encode !== 'function' ||
    typeof runtime[0].reset !== 'function' ||
    typeof runtime[0].stop !== 'function' ||
    typeof runtime[1] !== 'function'
  ) {
    fail('WebGL addon runtime factory contract is invalid')
  }
} finally {
  if (hadAddon) {
    globalThis.DATAFLUX_RUM_WEBGL = previousAddon
  } else {
    delete globalThis.DATAFLUX_RUM_WEBGL
  }
  if (hadRum) {
    globalThis.DATAFLUX_RUM = previousRum
  } else {
    delete globalThis.DATAFLUX_RUM
  }
}

console.log(
  `WebGL addon bundle contract: ${stableMemberKeys.length} runtime keys preserved`
)

function fail(message) {
  console.error(message)
  process.exit(1)
}
