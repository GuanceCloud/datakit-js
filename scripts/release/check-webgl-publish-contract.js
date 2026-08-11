const childProcess = require('child_process')

const rumPackage = require('../../packages/rum/package.json')
const rumWebGLPackage = require('../../packages/rum-webgl/package.json')
const { runMain } = require('../utils')

const HOST_PACKAGE_NAME = '@cloudcare/browser-rum'
const PLUGIN_PACKAGE_NAME = '@cloudcare/browser-rum-webgl'
// The registry manifest marker distinguishes a host that implements the
// cross-package WebGL plugin contract from an older package version that is
// still accepted by the plugin's nominal peer range.
const WEBGL_CAPABILITY_NAME = 'sessionReplayWebGLPlugin'
const WEBGL_CAPABILITY_VERSION = 1

function checkWebGLPublishContract({
  host,
  plugin,
  minimumHost
}) {
  const hostWillPublish = !host.published
  const pluginWillPublish = !plugin.published
  const localCapability = getWebGLCapability(host.local)
  if (localCapability < WEBGL_CAPABILITY_VERSION) {
    throw new Error(
      `${HOST_PACKAGE_NAME} must declare ${WEBGL_CAPABILITY_NAME} capability ${WEBGL_CAPABILITY_VERSION}`
    )
  }
  if (pluginWillPublish) {
    const minimumHostVersion = getMinimumHostVersion(plugin.local)

    const hostAtMinimumVersion =
      host.local.version === minimumHostVersion && hostWillPublish
        ? host.local
        : host.local.version === minimumHostVersion
        ? host.published
        : minimumHost
    if (
      getWebGLCapability(hostAtMinimumVersion) <
      WEBGL_CAPABILITY_VERSION
    ) {
      throw new Error(
        `${HOST_PACKAGE_NAME}@${minimumHostVersion} is not available with ${WEBGL_CAPABILITY_NAME} capability ${WEBGL_CAPABILITY_VERSION}. Publishing ${PLUGIN_PACKAGE_NAME}@${plugin.local.version} would expose it to an incompatible host.`
      )
    }
  }

  return { hostWillPublish, pluginWillPublish }
}

function getMinimumHostVersion(pluginManifest) {
  const peerRange =
    pluginManifest &&
    pluginManifest.peerDependencies &&
    pluginManifest.peerDependencies[HOST_PACKAGE_NAME]
  const match =
    typeof peerRange === 'string' &&
    /^>=(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)$/.exec(peerRange)
  if (!match) {
    throw new Error(
      `${PLUGIN_PACKAGE_NAME} must declare an exact minimum ${HOST_PACKAGE_NAME} peer range such as >=3.3.7; found ${peerRange}`
    )
  }
  const persistedMinimum =
    pluginManifest.browserSdkPeerMinimums &&
    pluginManifest.browserSdkPeerMinimums[HOST_PACKAGE_NAME]
  if (persistedMinimum && persistedMinimum !== match[1]) {
    throw new Error(
      `${PLUGIN_PACKAGE_NAME} peer floor ${match[1]} does not match its persisted ${HOST_PACKAGE_NAME} minimum ${persistedMinimum}`
    )
  }
  return match[1]
}

function getWebGLCapability(packageManifest) {
  if (!packageManifest || !packageManifest.browserSdkCapabilities) {
    return 0
  }
  const capability = Number(
    packageManifest.browserSdkCapabilities[WEBGL_CAPABILITY_NAME]
  )
  return Number.isFinite(capability) ? capability : 0
}

function readPublishedPackage(
  packageName,
  version,
  spawnSync = childProcess.spawnSync
) {
  const result = spawnSync(
    'npm',
    [
      'view',
      `${packageName}@${version}`,
      '--json',
      '--fetch-retries=0',
      '--fetch-timeout=10000'
    ],
    { encoding: 'utf8' }
  )
  if (result.status === 0) {
    try {
      const manifest = JSON.parse(result.stdout)
      if (!manifest || manifest.version !== version) {
        throw new Error('registry returned an unexpected package manifest')
      }
      return manifest
    } catch (error) {
      throw new Error(
        `Unable to validate ${packageName}@${version}: ${error.message}`
      )
    }
  }

  const output = `${result.stdout || ''}\n${result.stderr || ''}`
  var registryError
  try {
    registryError = JSON.parse(result.stdout || '{}').error
  } catch (_) {}
  if (
    (registryError && registryError.code === 'E404') ||
    /(?:^|\n)npm ERR! code E404(?:\n|$)/.test(output)
  ) {
    return undefined
  }
  const cause = result.error ? `: ${result.error.message}` : ''
  throw new Error(
    `Unable to query ${packageName}@${version}; release preflight fails closed${cause}`
  )
}

function main() {
  const host = {
    local: rumPackage,
    published: readPublishedPackage(HOST_PACKAGE_NAME, rumPackage.version)
  }
  const plugin = {
    local: rumWebGLPackage,
    published: readPublishedPackage(
      PLUGIN_PACKAGE_NAME,
      rumWebGLPackage.version
    )
  }
  const minimumHostVersion = getMinimumHostVersion(rumWebGLPackage)
  const minimumHost =
    rumPackage.version === minimumHostVersion
      ? host.published
      : readPublishedPackage(HOST_PACKAGE_NAME, minimumHostVersion)
  const plan = checkWebGLPublishContract({
    host,
    plugin,
    minimumHost
  })
  process.stdout.write(
    `WebGL release contract validated (host: ${
      plan.hostWillPublish ? 'publish' : 'already published'
    }, plugin: ${
      plan.pluginWillPublish ? 'publish' : 'already published'
    }).\n`
  )
}

if (require.main === module) {
  runMain(main)
}

module.exports = {
  checkWebGLPublishContract,
  getMinimumHostVersion,
  getWebGLCapability,
  readPublishedPackage
}
