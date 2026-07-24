const assert = require('assert')

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
  '@cloudcare/browser-rum-nuxt'
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
  '@cloudcare/browser-rum-nuxt': 'nuxtRumPlugin'
}

async function main() {
  require('@angular/compiler')

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
  }

  process.stdout.write(
    'Validated ' +
      resolvableEntries.length +
      ' framework package entries and both module loaders.\n'
  )
}

main().catch(function (error) {
  console.error(error)
  process.exitCode = 1
})
