const assert = require('assert')
const rumWebGLPackage = require('../packages/rum-webgl/package.json')
const {
  getMinimumRumPeerVersion,
  updateJsonPeerDependencies
} = require('./release/update-peer-dependency-versions')

const resolvableEntries = [
  '@cloudcare/browser-rum-react',
  '@cloudcare/browser-rum-react/react-router-v6',
  '@cloudcare/browser-rum-react/react-router-v7',
  '@cloudcare/browser-rum-react/react-router-v8',
  '@cloudcare/browser-rum-react/tanstack-router',
  '@cloudcare/browser-rum-vue',
  '@cloudcare/browser-rum-vue/vue-router-v3',
  '@cloudcare/browser-rum-vue/vue-router-v4',
  '@cloudcare/browser-rum-angular',
  '@cloudcare/browser-rum-angular/providers',
  '@cloudcare/browser-rum-nextjs',
  '@cloudcare/browser-rum-nuxt',
  '@cloudcare/browser-rum-webgl'
]

const loadableEntries = {
  '@cloudcare/browser-rum-react': 'reactPlugin',
  '@cloudcare/browser-rum-react/react-router-v6': 'createMemoryRouter',
  '@cloudcare/browser-rum-react/react-router-v7': 'createMemoryRouter',
  '@cloudcare/browser-rum-react/react-router-v8': 'createMemoryRouter',
  '@cloudcare/browser-rum-react/tanstack-router': 'createRouter',
  '@cloudcare/browser-rum-vue': 'vuePlugin',
  '@cloudcare/browser-rum-vue/vue-router-v4': 'createRouter',
  '@cloudcare/browser-rum-angular': 'angularPlugin',
  '@cloudcare/browser-rum-angular/providers': 'provideRumRouter',
  '@cloudcare/browser-rum-nextjs': 'nextjsPlugin',
  '@cloudcare/browser-rum-nuxt': 'nuxtRumPlugin',
  '@cloudcare/browser-rum-webgl': 'webglReplayPlugin'
}

async function main() {
  require('@angular/compiler')

  const expectedRumWebGLPeerVersion = '>=' + rumWebGLPackage.version
  assert.strictEqual(
    rumWebGLPackage.peerDependencies['@cloudcare/browser-rum'],
    expectedRumWebGLPeerVersion,
    '@cloudcare/browser-rum-webgl should remain installable in the current workspace'
  )
  const updatedRumWebGLPackage = JSON.parse(
    updateJsonPeerDependencies(
      JSON.stringify(rumWebGLPackage),
      rumWebGLPackage.version
    )
  )
  assert.strictEqual(
    updatedRumWebGLPackage.peerDependencies['@cloudcare/browser-rum'],
    expectedRumWebGLPeerVersion,
    'the release peer updater should preserve or advance the WebGL host minimum'
  )
  const nextRumVersion = getNextPatchVersion(rumWebGLPackage.version)
  const nextRumWebGLPackage = JSON.parse(
    updateJsonPeerDependencies(
      JSON.stringify(rumWebGLPackage),
      nextRumVersion
    )
  )
  assert.strictEqual(
    getMinimumRumPeerVersion(rumWebGLPackage.name, nextRumVersion),
    nextRumVersion,
    'the release peer updater should advance the WebGL peer with the unified release'
  )
  assert.strictEqual(
    nextRumWebGLPackage.peerDependencies['@cloudcare/browser-rum'],
    '>=' + nextRumVersion,
    'the release peer updater should write the next unified WebGL host minimum'
  )

  resolvableEntries.forEach(function (entry) {
    assert.ok(require.resolve(entry), entry + ' should resolve')
  })

  for (const entry of Object.keys(loadableEntries)) {
    const exportName = loadableEntries[entry]
    const commonjsModule = require(entry)
    assert.strictEqual(
      typeof commonjsModule[exportName],
      'function',
      entry + ' should expose ' + exportName + ' through require()'
    )

    const importedModule = await import(entry)
    assert.strictEqual(
      typeof importedModule[exportName],
      'function',
      entry + ' should expose ' + exportName + ' through import()'
    )

    if (entry === '@cloudcare/browser-rum-webgl') {
      assert.strictEqual(
        Object.prototype.hasOwnProperty.call(
          globalThis,
          'DATAFLUX_RUM_WEBGL'
        ),
        false,
        entry + ' npm entry should not define the CDN global'
      )
      const plugin = importedModule.webglReplayPlugin()
      assert.strictEqual(plugin.name, 'session-replay-webgl')
      assert.strictEqual(plugin.sessionReplayWebGL, undefined)
      const initConfiguration = { replayCanvasEnabled: false }
      plugin.onInit({ initConfiguration })
      assert.strictEqual(
        typeof initConfiguration.sessionReplayWebGL,
        'function'
      )
      const baseEncodeBridge = {
        encode: () => Promise.resolve({ ok: false, reason: 'test' }),
        encodeWithLifecycle: () => {
          const result = Promise.resolve({ ok: false, reason: 'test' })
          return { result, physicalSettled: result.then(() => {}) }
        },
        reset: () => {},
        stop: () => {}
      }
      const runtime = initConfiguration.sessionReplayWebGL(
        { replayCanvasMaxConcurrentEncodes: 1 },
        baseEncodeBridge,
        (canvas) => canvas
      )
      assert.ok(Array.isArray(runtime))
      assert.strictEqual(typeof runtime[0].encode, 'function')
      assert.strictEqual(typeof runtime[0].reset, 'function')
      assert.strictEqual(typeof runtime[0].stop, 'function')
      assert.strictEqual(
        typeof runtime[1],
        'function'
      )
    }
  }

  process.stdout.write(
    'Validated ' +
      resolvableEntries.length +
      ' integration package entries and both module loaders.\n'
  )
}

function getNextPatchVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(version)
  assert.ok(match, 'the current WebGL package version should be semver-like')
  return [match[1], match[2], Number(match[3]) + 1].join('.') + match[4]
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
