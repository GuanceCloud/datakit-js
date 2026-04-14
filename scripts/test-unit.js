const { spawn } = require('child_process')
const { spawnSync } = require('child_process')
const path = require('path')

const args = process.argv.slice(2)
const karmaArgs = ['start', './test/unit/karma.local.conf.js']
let specPattern = ''
let grepPattern = ''

for (let i = 0; i < args.length; i += 1) {
  const arg = args[i]

  if (arg === '--spec') {
    specPattern = args[i + 1] || ''
    i += 1
    continue
  }

  if (arg.indexOf('--spec=') === 0) {
    specPattern = arg.slice('--spec='.length)
    continue
  }

  if (arg === '--grep') {
    grepPattern = args[i + 1] || ''
    i += 1
    continue
  }

  if (arg.indexOf('--grep=') === 0) {
    grepPattern = arg.slice('--grep='.length)
    continue
  }

  karmaArgs.push(arg)
}

if (specPattern) {
  specPattern = resolveSpecPattern(specPattern)
}

const child = spawn(
  process.execPath,
  [require.resolve('karma/bin/karma'), ...karmaArgs],
  {
    stdio: 'inherit',
    env:
      specPattern || grepPattern
        ? {
            ...process.env,
            ...(specPattern ? { KARMA_SPEC_PATTERN: specPattern } : null),
            ...(grepPattern ? { KARMA_GREP: grepPattern } : null)
          }
        : process.env,
    cwd: path.resolve(__dirname, '..')
  }
)

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code || 0)
})

function resolveSpecPattern(rawPattern) {
  const patterns = rawPattern
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)

  return patterns
    .map((pattern) => {
      if (looksLikePathOrGlob(pattern)) {
        return pattern
      }

      const matchedSpecs = findMatchingSpecs(pattern)
      if (matchedSpecs.length === 1) {
        return matchedSpecs[0]
      }

      if (matchedSpecs.length === 0) {
        console.error(`No spec matched "${pattern}".`)
        process.exit(1)
      }

      console.error(`Spec pattern "${pattern}" is ambiguous. Matches:`)
      matchedSpecs.slice(0, 20).forEach((spec) => console.error(`- ${spec}`))
      if (matchedSpecs.length > 20) {
        console.error(`- ...and ${matchedSpecs.length - 20} more`)
      }
      process.exit(1)
    })
    .join(',')
}

function looksLikePathOrGlob(pattern) {
  return /[/*?[\]]/.test(pattern) || pattern.indexOf('packages/') === 0
}

function findMatchingSpecs(pattern) {
  const result = spawnSync(
    'rg',
    ['--files', 'packages', '-g', '*.spec.js'],
    {
      cwd: path.resolve(__dirname, '..'),
      encoding: 'utf8'
    }
  )

  if (result.status !== 0) {
    console.error(result.stderr || 'Failed to list spec files with rg.')
    process.exit(result.status || 1)
  }

  const normalizedPattern = pattern.toLowerCase()
  return result.stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => file.toLowerCase().indexOf(normalizedPattern) !== -1)
}
