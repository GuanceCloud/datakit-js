const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const format = process.argv[2]
if (format !== 'cjs' && format !== 'esm') {
  throw new Error('Usage: node scripts/build-module.js <cjs|esm>')
}

const packageRoot = path.resolve(__dirname, '..')
const repositoryRoot = path.resolve(packageRoot, '../..')
const outDir = path.join(packageRoot, format)
const babelBin = path.join(repositoryRoot, 'node_modules/.bin/babel')
const babelConfig = path.join(packageRoot, `babel.${format}.json`)

fs.rmSync(outDir, { recursive: true, force: true })
runBabel(path.join(repositoryRoot, 'packages/rum/src'))
runBabel(path.join(packageRoot, 'src'))
rewriteSlimImports()
removeFullRumOnlyOutput()
replaceBuildEnv()

function runBabel(input) {
  execFileSync(
    babelBin,
    ['--config-file', babelConfig, '--out-dir', outDir, input],
    {
      cwd: packageRoot,
      stdio: 'inherit'
    }
  )
}

function rewriteSlimImports() {
  const indexFile = path.join(outDir, 'index.js')
  const content = fs.readFileSync(indexFile, 'utf8')
  fs.writeFileSync(
    indexFile,
    content.replace(
      /\.\.\/\.\.\/rum\/src\/boot\/rum\.slim\.entry/g,
      './boot/rum.slim.entry'
    )
  )
}

function removeFullRumOnlyOutput() {
  ;[
    'boot/recorderApi.js',
    'boot/recorderApi.js.map',
    'boot/recorderApiStub.js',
    'boot/recorderApiStub.js.map',
    'boot/rum.entry.js',
    'boot/rum.entry.js.map',
    'boot/sessionReplayPublicApi.js',
    'boot/sessionReplayPublicApi.js.map',
    'boot/startRecording.js',
    'boot/startRecording.js.map',
    'domain/deflate',
    'domain/replay',
    'types'
  ].forEach((relativePath) => {
    fs.rmSync(path.join(outDir, relativePath), {
      recursive: true,
      force: true
    })
  })
}

function replaceBuildEnv() {
  execFileSync(
    process.execPath,
    [path.join(repositoryRoot, 'scripts/replace-build-env.js'), outDir],
    {
      cwd: packageRoot,
      stdio: 'inherit'
    }
  )
}
