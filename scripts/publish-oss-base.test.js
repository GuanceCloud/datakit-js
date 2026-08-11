const assert = require('assert')
const childProcess = require('child_process')
const fs = require('fs')
const path = require('path')

const publishOss = require('./publish-oss-base')

assert.deepStrictEqual(
  publishOss.getObjectNames('dataflux-rum', 'test', '3.3.6'),
  [
    {
      fileName: 'dataflux-rum.js',
      objectName: 'browser-sdk/v3/dataflux-rum-test.js'
    },
    {
      fileName: 'dataflux-rum.js.map',
      objectName: 'browser-sdk/v3/dataflux-rum-test.js.map'
    }
  ]
)
assert.deepStrictEqual(
  publishOss.getObjectNames('dataflux-rum', 'beta', '3.3.6').map(
    ({ objectName }) => objectName
  ),
  [
    'browser-sdk/v3/BETA/dataflux-rum.js',
    'browser-sdk/v3/BETA/dataflux-rum.js.map'
  ]
)

async function main() {
  const uploads = []
  await publishOss(
    { filename: 'dataflux-rum' },
    {
      buildArg: 'current',
      bundleDirectory: '/virtual/bundle',
      printLog: () => {},
      readFile: async (filePath) => Buffer.from(filePath),
      client: {
        put: async (objectName, content, options) => {
          uploads.push({ objectName, content, options })
        }
      }
    }
  )
  assert.deepStrictEqual(
    uploads.map((upload) => upload.objectName),
    [
      'browser-sdk/v3/dataflux-rum.js.map',
      'browser-sdk/v3/dataflux-rum.js'
    ]
  )

  const uploadsAfterReadFailure = []
  await assert.rejects(
    publishOss(
      { filename: 'dataflux-rum' },
      {
        buildArg: 'current',
        bundleDirectory: '/virtual/bundle',
        printLog: () => {},
        readFile: async (filePath) => {
          if (filePath.endsWith('.js')) {
            throw new Error('missing runtime bundle')
          }
          return Buffer.from('source map')
        },
        client: {
          put: async (objectName) => uploadsAfterReadFailure.push(objectName)
        }
      }
    ),
    /missing runtime bundle/
  )
  assert.deepStrictEqual(
    uploadsAfterReadFailure,
    [],
    'no OSS mutation should start until every artifact has been read'
  )

  const uploadsBeforeMapFailure = []
  await assert.rejects(
    publishOss(
      { filename: 'dataflux-rum' },
      {
        buildArg: 'lts',
        bundleDirectory: '/virtual/bundle',
        printLog: () => {},
        readFile: async () => Buffer.from('content'),
        client: {
          put: async (objectName) => {
            uploadsBeforeMapFailure.push(objectName)
            if (objectName.endsWith('.map')) {
              throw new Error('upload rejected')
            }
          }
        }
      }
    ),
    /upload rejected/
  )
  assert.deepStrictEqual(uploadsBeforeMapFailure, [
    'browser-sdk/v3/LTS/dataflux-rum.js.map'
  ])

  const workerUploads = []
  await publishOss(
    { filenames: ['worker', 'canvas-worker'] },
    {
      buildArg: 'current',
      bundleDirectory: '/virtual/bundle',
      printLog: () => {},
      readFile: async (filePath) => Buffer.from(filePath),
      client: {
        put: async (objectName) => workerUploads.push(objectName)
      }
    }
  )
  assert.deepStrictEqual(workerUploads, [
    'browser-sdk/v3/worker.js.map',
    'browser-sdk/v3/canvas-worker.js.map',
    'browser-sdk/v3/worker.js',
    'browser-sdk/v3/canvas-worker.js'
  ])

  const workerUploadsAfterReadFailure = []
  await assert.rejects(
    publishOss(
      { filenames: ['worker', 'canvas-worker'] },
      {
        buildArg: 'current',
        bundleDirectory: '/virtual/bundle',
        printLog: () => {},
        readFile: async (filePath) => {
          if (filePath.endsWith('/canvas-worker.js')) {
            throw new Error('missing canvas worker bundle')
          }
          return Buffer.from(filePath)
        },
        client: {
          put: async (objectName) =>
            workerUploadsAfterReadFailure.push(objectName)
        }
      }
    ),
    /missing canvas worker bundle/
  )
  assert.deepStrictEqual(
    workerUploadsAfterReadFailure,
    [],
    'worker and canvas-worker must both be readable before either is uploaded'
  )

  await assert.rejects(
    publishOss(
      { filename: 'dataflux-rum' },
      {
        buildArg: 'unknown',
        printLog: () => {},
        readFile: async () => Buffer.from('content'),
        client: { put: async () => {} }
      }
    ),
    /Unknown OSS publish channel/
  )

  const wrapperResult = childProcess.spawnSync(
    process.execPath,
    [
      path.resolve(
        __dirname,
        '../packages/rum/scripts/publish-oss.js'
      ),
      'unknown'
    ],
    { encoding: 'utf8' }
  )
  assert.notStrictEqual(
    wrapperResult.status,
    0,
    'the package wrapper should expose upload failures as a non-zero exit'
  )
  assert.match(
    `${wrapperResult.stdout}\n${wrapperResult.stderr}`,
    /Unknown OSS publish channel/
  )

  const rejectionScript = `
    const publishOss = require(${JSON.stringify(
      path.resolve(__dirname, 'publish-oss-base.js')
    )})
    const { runMain } = require(${JSON.stringify(
      path.resolve(__dirname, 'utils.js')
    )})
    runMain(() => publishOss(
      { filename: 'dataflux-rum' },
      {
        buildArg: 'current',
        bundleDirectory: '/virtual/bundle',
        readFile: async () => Buffer.from('content'),
        client: { put: async () => { throw new Error('upload rejected') } }
      }
    ))
  `
  const rejectedUploadResult = childProcess.spawnSync(
    process.execPath,
    ['-e', rejectionScript],
    { encoding: 'utf8' }
  )
  assert.notStrictEqual(
    rejectedUploadResult.status,
    0,
    'a rejected OSS upload should make the command exit non-zero'
  )
  assert.match(
    `${rejectedUploadResult.stdout}\n${rejectedUploadResult.stderr}`,
    /upload rejected/
  )

  const wrapperPaths = [
    '../packages/rum/scripts/publish-oss.js',
    '../packages/rum-webgl/scripts/publish-oss.js',
    '../packages/rum-slim/scripts/publish-oss.js',
    '../packages/logs/scripts/publish-oss.js',
    '../packages/worker/scripts/publish-oss.js'
  ]
  wrapperPaths.forEach((wrapperPath) => {
    const wrapperSource = fs.readFileSync(
      path.resolve(__dirname, wrapperPath),
      'utf8'
    )
    assert.match(wrapperSource, /runMain\(/, `${wrapperPath} should use runMain`)
    assert.match(wrapperSource, /runOss\(/, `${wrapperPath} should return or await runOss`)
  })
  const workerWrapper = fs.readFileSync(
    path.resolve(__dirname, '../packages/worker/scripts/publish-oss.js'),
    'utf8'
  )
  assert.strictEqual(
    (workerWrapper.match(/runOss\(/g) || []).length,
    1,
    'the worker wrapper should preflight and publish both bundles together'
  )
  assert.match(workerWrapper, /filenames:\s*\['worker', 'canvas-worker'\]/)

  process.stdout.write('Validated awaited and fail-closed OSS publishing.\n')
}

main().catch((error) => {
  process.stderr.write(`${error.stack}\n`)
  process.exitCode = 1
})
