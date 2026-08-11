const assert = require('assert')

const {
  checkWebGLPublishContract,
  readPublishedPackage
} = require('./check-webgl-publish-contract')

const HOST_PACKAGE_NAME = '@cloudcare/browser-rum'

function manifest(version, capable) {
  return {
    version,
    browserSdkCapabilities: capable
      ? { sessionReplayWebGLPlugin: 1 }
      : undefined
  }
}

function pluginManifest(version, minimumHostVersion = version) {
  return {
    version,
    peerDependencies: {
      [HOST_PACKAGE_NAME]: `>=${minimumHostVersion}`
    }
  }
}

function check(input) {
  return checkWebGLPublishContract({
    host: {
      local: manifest(input.hostVersion || input.version, true),
      published: input.publishedHost
    },
    plugin: {
      local: pluginManifest(
        input.pluginVersion || input.version,
        input.minimumHostVersion || input.pluginVersion || input.version
      ),
      published: input.publishedPlugin
    },
    minimumHost: input.minimumHost
  })
}

assert.deepStrictEqual(check({ version: '3.3.7' }), {
  hostWillPublish: true,
  pluginWillPublish: true
})

assert.throws(
  () =>
    check({
      version: '3.3.6',
      publishedHost: manifest('3.3.6', false)
    }),
  /is not available with sessionReplayWebGLPlugin capability/
)

assert.throws(
  () =>
    check({
      version: '3.3.6',
      publishedHost: {
        version: '3.3.6',
        browserSdkCapabilities: { sessionReplayWebGLPlugin: 'invalid' }
      }
    }),
  /is not available with sessionReplayWebGLPlugin capability/
)

assert.deepStrictEqual(
  check({
    version: '3.3.7',
    publishedHost: manifest('3.3.7', true)
  }),
  { hostWillPublish: false, pluginWillPublish: true }
)

assert.throws(
  () =>
    checkWebGLPublishContract({
      host: { local: manifest('3.3.8', true) },
      plugin: {
        local: Object.assign(pluginManifest('3.3.8', '3.3.7'), {
          browserSdkPeerMinimums: {
            [HOST_PACKAGE_NAME]: '3.3.8'
          }
        })
      },
      minimumHost: manifest('3.3.7', true)
    }),
  /peer floor 3\.3\.7 does not match its persisted @cloudcare\/browser-rum minimum 3\.3\.8/
)

assert.deepStrictEqual(
  check({
    version: '3.3.7',
    publishedHost: manifest('3.3.7', true),
    publishedPlugin: pluginManifest('3.3.7')
  }),
  { hostWillPublish: false, pluginWillPublish: false }
)

assert.deepStrictEqual(
  check({
    version: '3.3.8',
    hostVersion: '3.3.7',
    pluginVersion: '3.3.7',
    publishedHost: manifest('3.3.7', true),
    publishedPlugin: pluginManifest('3.3.7')
  }),
  { hostWillPublish: false, pluginWillPublish: false },
  'an unrelated fixed-mode release must not require host/plugin versions to match lerna.json'
)

assert.deepStrictEqual(
  check({
    hostVersion: '3.3.8',
    pluginVersion: '3.3.7',
    publishedPlugin: pluginManifest('3.3.7'),
    minimumHost: manifest('3.3.7', true)
  }),
  { hostWillPublish: true, pluginWillPublish: false },
  'a host-only release must not republish an unchanged addon'
)

assert.throws(
  () =>
    checkWebGLPublishContract({
      host: { local: manifest('3.3.7', true) },
      plugin: {
        local: {
          version: '3.3.7',
          peerDependencies: { [HOST_PACKAGE_NAME]: '^3.3.6' }
        }
      }
    }),
  /must declare an exact minimum @cloudcare\/browser-rum peer range/
)

assert.deepStrictEqual(
  check({
    hostVersion: '3.3.8',
    pluginVersion: '3.3.7',
    minimumHost: manifest('3.3.7', true)
  }),
  { hostWillPublish: true, pluginWillPublish: true },
  'a plugin retry may use a previously published capable minimum host'
)

assert.throws(
  () =>
    check({
      hostVersion: '3.3.8',
      pluginVersion: '3.3.7',
      minimumHost: manifest('3.3.7', false)
    }),
  /Publishing @cloudcare\/browser-rum-webgl@3\.3\.7 would expose it to an incompatible host/
)

assert.deepStrictEqual(
  check({
    hostVersion: '3.3.7',
    pluginVersion: '3.3.8',
    minimumHostVersion: '3.3.7',
    publishedHost: manifest('3.3.7', true),
    minimumHost: manifest('3.3.7', true)
  }),
  { hostWillPublish: false, pluginWillPublish: true },
  'a plugin-only patch may retain the first capable host as its peer floor'
)

assert.strictEqual(
  readPublishedPackage('@scope/missing', '1.0.0', () => ({
    status: 1,
    stdout: JSON.stringify({ error: { code: 'E404' } }),
    stderr: ''
  })),
  undefined
)

let npmViewArguments
assert.deepStrictEqual(
  readPublishedPackage('@scope/package', '1.0.0', (command, args) => {
    npmViewArguments = { command, args }
    return {
      status: 0,
      stdout: JSON.stringify(manifest('1.0.0', true)),
      stderr: ''
    }
  }),
  manifest('1.0.0', true)
)
assert.strictEqual(npmViewArguments.command, 'npm')
assert.ok(npmViewArguments.args.includes('@scope/package@1.0.0'))
assert.ok(npmViewArguments.args.includes('--fetch-retries=0'))
assert.ok(npmViewArguments.args.includes('--fetch-timeout=10000'))

assert.throws(
  () =>
    readPublishedPackage('@scope/package', '1.0.0', () => ({
      status: 1,
      stdout: '',
      stderr: 'network timeout',
      error: new Error('ETIMEDOUT')
    })),
  /release preflight fails closed/
)

process.stdout.write('Validated WebGL npm release preflight logic.\n')
