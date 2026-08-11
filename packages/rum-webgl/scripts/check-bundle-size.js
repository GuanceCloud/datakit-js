const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')

// Keep enough headroom for small compatibility fixes without allowing the
// optional addon to silently grow back toward the size it had before the
// WebGL implementation was split and made self-contained.
const RAW_BYTES_LIMIT = 25000
const GZIP_BYTES_LIMIT = 9000
const bundlePath = path.resolve(
  __dirname,
  '../bundle/dataflux-rum-webgl.js'
)

if (!fs.existsSync(bundlePath)) {
  fail(`WebGL addon bundle not found: ${bundlePath}`)
}

const rawBytes = fs.statSync(bundlePath).size
const gzipResult = spawnSync('gzip', ['-9', '-n', '-c', bundlePath], {
  encoding: null,
  maxBuffer: 1024 * 1024
})
if (gzipResult.error || gzipResult.status !== 0) {
  fail(
    `Unable to measure deterministic gzip size: ${
      gzipResult.error || String(gzipResult.stderr || '').trim()
    }`
  )
}
const gzipBytes = gzipResult.stdout.length
const failures = []
if (rawBytes > RAW_BYTES_LIMIT) {
  failures.push(`raw size exceeds budget by ${rawBytes - RAW_BYTES_LIMIT}`)
}
if (gzipBytes > GZIP_BYTES_LIMIT) {
  failures.push(`gzip size exceeds budget by ${gzipBytes - GZIP_BYTES_LIMIT}`)
}

console.log(
  [
    'WebGL addon bundle size:',
    `raw: ${rawBytes} / ${RAW_BYTES_LIMIT} bytes`,
    `gzip -9 -n: ${gzipBytes} / ${GZIP_BYTES_LIMIT} bytes`
  ].join('\n')
)
if (failures.length) {
  fail(failures.join('; '))
}

function fail(message) {
  console.error(message)
  process.exit(1)
}
