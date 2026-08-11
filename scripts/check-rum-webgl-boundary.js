const fs = require('fs')
const path = require('path')

const bundlePath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.resolve(
      __dirname,
      '../packages/rum/bundle/dataflux-rum.js'
    )
const sourceMapPath = `${bundlePath}.map`
const forbiddenBundleTokens = [
  'readPixels',
  'MAX_WEBGL_',
  'WebGL replay readback',
  'WebGL staging memory'
]
const stableContractKeys = [
  // Runtime registration and the bridge lifecycle cross independently
  // minified bundles. The runtime itself is returned as a positional tuple.
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
  fail(`RUM bundle not found: ${bundlePath}`)
}
if (!fs.existsSync(sourceMapPath)) {
  fail(`RUM source map not found: ${sourceMapPath}`)
}

const bundleSource = fs.readFileSync(bundlePath, 'utf8')
const forbiddenTokensFound = forbiddenBundleTokens.filter((token) =>
  bundleSource.includes(token)
)
if (forbiddenTokensFound.length) {
  fail(
    `Base RUM bundle still contains WebGL implementation tokens: ${forbiddenTokensFound.join(
      ', '
    )}`
  )
}

const sourceMap = JSON.parse(fs.readFileSync(sourceMapPath, 'utf8'))
const forbiddenSources = (sourceMap.sources || []).filter((source) =>
  /(?:canvasWebGLSnapshotObserver|packages\/rum-webgl\/|packages\/rum\/test\/|(?:^|\/)test\/replay\/|\.spec\.js(?:\?|$)|canvasReplayFixtures)/.test(
    source
  )
)
if (forbiddenSources.length) {
  fail(
    `Base RUM bundle still imports WebGL or test-only modules: ${forbiddenSources.join(
      ', '
    )}`
  )
}

const missingContractKeys = stableContractKeys.filter(
  (key) => !hasProperty(bundleSource, key)
)
if (missingContractKeys.length) {
  fail(
    `Base RUM bundle mangled or removed WebGL plugin contract keys: ${missingContractKeys.join(
      ', '
    )}`
  )
}

console.log(
  `RUM WebGL boundary: base graph excludes implementation; ${stableContractKeys.length} runtime contract keys preserved`
)

function hasProperty(source, key) {
  const escapedKey = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(
    `(?:\\.${escapedKey}\\b|\\[["']${escapedKey}["']\\]|(?:^|[,{])(?:["']?)${escapedKey}(?:["']?)\\s*:)`,
    'm'
  ).test(source)
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
