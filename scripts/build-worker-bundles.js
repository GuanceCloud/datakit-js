const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const lockfile = require('proper-lockfile')

const { command } = require('./command')

const repositoryRoot = path.resolve(__dirname, '..')
const workerRoot = path.join(repositoryRoot, 'packages/worker')
const bundleRoot = path.join(workerRoot, 'bundle')
const stampPath = path.join(bundleRoot, '.build-stamp.json')
const lockPath = path.join(workerRoot, '.bundle-build.lock')
const outputPaths = [
  path.join(bundleRoot, 'worker.js'),
  path.join(bundleRoot, 'canvas-worker.js')
]
const inputPaths = [
  path.join(repositoryRoot, 'package.json'),
  path.join(repositoryRoot, 'package-lock.json'),
  path.join(repositoryRoot, 'lerna.json'),
  path.join(repositoryRoot, 'webpack.base.js'),
  path.join(repositoryRoot, 'scripts/build-env.js'),
  path.join(repositoryRoot, 'scripts/build-worker-bundles.js'),
  path.join(repositoryRoot, 'scripts/check-worker-bundle-contract.js'),
  path.join(repositoryRoot, 'scripts/check-worker-package-content.js'),
  path.join(workerRoot, '.npmignore'),
  path.join(workerRoot, 'package.json'),
  path.join(workerRoot, 'webpack.config.js'),
  path.join(workerRoot, 'src'),
  path.join(repositoryRoot, 'packages/core/package.json'),
  path.join(repositoryRoot, 'packages/core/src')
]

async function buildWorkerBundles() {
  const release = await lockfile.lock(workerRoot, {
    lockfilePath: lockPath,
    stale: 30000,
    update: 5000,
    retries: {
      retries: 300,
      factor: 1.1,
      minTimeout: 25,
      maxTimeout: 500,
      randomize: true
    }
  })

  try {
    const inputFingerprint = fingerprintPaths(inputPaths)
    if (hasCurrentOutputs(inputFingerprint)) {
      return
    }

    const output = command`npm run build:unlocked`
      .withCurrentWorkingDirectory(workerRoot)
      .run()
    if (output) {
      process.stdout.write(output)
    }

    const outputFingerprints = outputPaths.map(fingerprintFile)
    const temporaryStampPath = `${stampPath}.${process.pid}`
    fs.writeFileSync(
      temporaryStampPath,
      JSON.stringify({ inputFingerprint, outputFingerprints })
    )
    fs.renameSync(temporaryStampPath, stampPath)
  } finally {
    await release()
  }
}

function hasCurrentOutputs(inputFingerprint) {
  try {
    const stamp = JSON.parse(fs.readFileSync(stampPath, 'utf8'))
    return (
      stamp.inputFingerprint === inputFingerprint &&
      Array.isArray(stamp.outputFingerprints) &&
      stamp.outputFingerprints.length === outputPaths.length &&
      outputPaths.every(
        (outputPath, index) =>
          fingerprintFile(outputPath) === stamp.outputFingerprints[index]
      )
    )
  } catch (_) {
    return false
  }
}

function fingerprintPaths(paths) {
  const hash = crypto.createHash('sha256')
  paths.forEach((inputPath) => updateHashFromPath(hash, inputPath))
  return hash.digest('hex')
}

function updateHashFromPath(hash, inputPath) {
  const stat = fs.statSync(inputPath)
  if (stat.isDirectory()) {
    fs.readdirSync(inputPath)
      .sort()
      .forEach((entry) =>
        updateHashFromPath(hash, path.join(inputPath, entry))
      )
    return
  }
  hash.update(path.relative(repositoryRoot, inputPath))
  hash.update('\0')
  hash.update(fs.readFileSync(inputPath))
  hash.update('\0')
}

function fingerprintFile(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex')
}

buildWorkerBundles().catch((error) => {
  console.error(error && error.stack ? error.stack : error)
  process.exitCode = 1
})
