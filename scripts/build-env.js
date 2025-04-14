const { readFileSync } = require('fs')
const path = require('path')
const execSync = require('child_process').execSync
const lernaJson = require('../lerna.json')
const { command } = require('./command')

// module.exports = (mode) => {
//   const env = {}
//   if (mode === 'development') {
//     env.SDK_VERSION = 'dev'
//   } else {
//     env.SDK_VERSION = sdkVersion
//   }
//   return env
// }
const buildEnvCache = new Map()

const buildEnvFactories = {
  SDK_VERSION: (mode) => {
    if (mode === 'development') {
      return 'dev'
    } else {
      return lernaJson.version
    }
  },
  WORKER_STRING: () => {
    const workerPath = path.join(__dirname, '../packages/worker')
    // Make sure the worker is built
    // TODO: Improve overall built time by rebuilding the worker only if its sources have changed?
    // TODO: Improve developer experience during tests by detecting worker source changes?
    command`npm run build`.withCurrentWorkingDirectory(workerPath).run()
    return readFileSync(path.join(workerPath, 'bundle/worker.js'), {
      encoding: 'utf-8'
    })
  }
}

module.exports = {
  buildEnvKeys: Object.keys(buildEnvFactories),

  getBuildEnvValue: (key, mode) => {
    let value = buildEnvCache.get(key)
    if (!value) {
      value = buildEnvFactories[key](mode)
      buildEnvCache.set(key, value)
    }
    return value
  }
}
