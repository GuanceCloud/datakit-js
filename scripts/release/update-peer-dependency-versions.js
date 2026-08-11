const lernaConfig = require('../../lerna.json')
const { runMain } = require('../utils')
const { modifyFile } = require('../files-utils')
const { command } = require('../command')

const JSON_FILES = [
  'rum-react',
  'rum-vue',
  'rum-angular',
  'rum-nextjs',
  'rum-nuxt',
  'rum-webgl'
].map((packageName) => `./packages/${packageName}/package.json`)
const RUM_PEER_DEPENDENCIES = [
  '@cloudcare/browser-rum',
  '@cloudcare/browser-rum-slim'
]

// Keep integration plugins from being installed with an older RUM runtime that
// does not implement their plugin lifecycle or cross-bundle capability
// contract.
//
// Lerna [intentionally removed support for it][1], and [closed a feature request asking for an
// option to bump them on publish][2], but we still want to make sure this version is updated as
// well to prevent framework plugins from declaring compatibility with an older RUM package.
//
// [1]: https://github.com/lerna/lerna/commit/bdbfc62966e5351abfeac77830f9d47b6d69f1b1
// [2]: https://github.com/lerna/lerna/issues/1575
if (require.main === module) {
  runMain(async () => {
    for (const jsonFile of JSON_FILES) {
      await modifyFile(jsonFile, updateJsonPeerDependencies)
    }
    command`npm install --package-lock-only --ignore-scripts`.run()
  })
}

function updateJsonPeerDependencies(
  content,
  rumVersion = lernaConfig.version
) {
  const json = JSON.parse(content)
  const indentation = content.match(/^\{\n(\s+)"/)
  const configuredMinimums = json.browserSdkPeerMinimums || {}
  const minimumRumVersion = getMinimumRumPeerVersion(
    json.name,
    rumVersion,
    configuredMinimums['@cloudcare/browser-rum']
  )
  if (json.name === '@cloudcare/browser-rum-webgl') {
    json.browserSdkPeerMinimums = Object.assign({}, configuredMinimums, {
      '@cloudcare/browser-rum': minimumRumVersion
    })
  }
  RUM_PEER_DEPENDENCIES.forEach((packageName) => {
    if (json.peerDependencies[packageName]) {
      json.peerDependencies[packageName] = `>=${minimumRumVersion}`
    }
  })
  return `${JSON.stringify(
    json,
    null,
    indentation ? indentation[1].length : 2
  )}\n`
}

function getMinimumRumPeerVersion(
  packageName,
  rumVersion = lernaConfig.version,
  configuredMinimumVersion
) {
  if (
    packageName === '@cloudcare/browser-rum-webgl' &&
    typeof configuredMinimumVersion === 'string' &&
    configuredMinimumVersion
  ) {
    return configuredMinimumVersion
  }
  return rumVersion
}

module.exports = {
  getMinimumRumPeerVersion,
  updateJsonPeerDependencies
}
