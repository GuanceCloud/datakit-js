const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')

const repositoryRoot = path.resolve(__dirname, '..')
const packageRoot = path.join(repositoryRoot, 'packages/worker')
const cacheDirectory = fs.mkdtempSync(
  path.join(os.tmpdir(), 'browser-sdk-worker-pack-')
)

try {
  const npmCli = process.env.npm_execpath
  const executable = npmCli ? process.execPath : 'npm'
  const args = npmCli
    ? [npmCli, 'pack', '--dry-run', '--ignore-scripts', '--json']
    : ['pack', '--dry-run', '--ignore-scripts', '--json']
  const result = spawnSync(executable, args, {
    cwd: packageRoot,
    encoding: 'utf8',
    env: {
      ...process.env,
      npm_config_cache: cacheDirectory
    }
  })

  if (result.error || result.status !== 0) {
    throw new Error(
      `Unable to inspect worker npm package: ${
        result.error || String(result.stderr || result.stdout || '').trim()
      }`
    )
  }

  const packs = JSON.parse(result.stdout)
  const files =
    packs[0] && Array.isArray(packs[0].files)
      ? packs[0].files.map((file) => file.path)
      : []
  const requiredFiles = ['bundle/worker.js', 'bundle/canvas-worker.js']
  const missingFiles = requiredFiles.filter((file) => !files.includes(file))
  if (missingFiles.length) {
    throw new Error(
      `Worker npm package is missing generated assets: ${missingFiles.join(', ')}`
    )
  }

  console.log(
    `Worker npm package content: ${requiredFiles.join(', ')} included`
  )
} catch (error) {
  console.error(error && error.message ? error.message : error)
  process.exitCode = 1
} finally {
  fs.rmSync(cacheDirectory, { recursive: true, force: true })
}
