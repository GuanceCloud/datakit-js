const OSS = require('ali-oss')
const fs = require('fs')
const path = require('path')
const { printLog } = require('./utils')

const packageJSON = require('../lerna.json')
const sdkVersion = packageJSON.version

async function publishOss({ filename, filenames }, dependencies = {}) {
  const buildArg = dependencies.buildArg || process.argv[2]
  const bundleNames = filenames || [filename]
  const objectNames = bundleNames.reduce(
    (entries, bundleName) =>
      entries.concat(getObjectNames(bundleName, buildArg, sdkVersion)),
    []
  )
  const client =
    dependencies.client ||
    createClient(
      dependencies.configuration || require('../config/config.json')
    )
  const readFile = dependencies.readFile || fs.promises.readFile
  const log = dependencies.printLog || printLog
  const bundleDirectory =
    dependencies.bundleDirectory || path.resolve('./bundle')

  // Fail before mutating OSS when any local artifact is missing.  Upload
  // source maps first and executable entry points last so a later failure
  // cannot replace the runtime while leaving its map stale or absent.
  const artifacts = await Promise.all(
    objectNames.map(async ({ fileName, objectName }) => {
      const fullPath = path.join(bundleDirectory, fileName)
      const content = await readFile(fullPath)
      return { fileName, objectName, content }
    })
  )
  artifacts.sort((left, right) => {
    const leftIsMap = left.fileName.endsWith('.map')
    const rightIsMap = right.fileName.endsWith('.map')
    return leftIsMap === rightIsMap ? 0 : leftIsMap ? -1 : 1
  })
  for (const artifact of artifacts) {
    log('file publish oss:', artifact.objectName)
    await client.put(artifact.objectName, artifact.content, {
      mime: 'application/javascript'
    })
  }
}

function createClient(configuration) {
  if (!configuration || !configuration.oss) {
    throw new Error('load oss config fail')
  }
  const { region, accessKeyId, accessKeySecret, bucket } = configuration.oss
  return new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket
  })
}

function getObjectNames(filename, buildArg, version) {
  const versionMajor = `v${version.split('.')[0]}`
  const files = [`${filename}.js`, `${filename}.js.map`]

  if (!['test', 'lts', 'current', 'beta'].includes(buildArg)) {
    throw new Error(`Unknown OSS publish channel: ${buildArg || '<missing>'}`)
  }

  return files.map((fileName) => {
    let publishedFileName = fileName
    let directory = `browser-sdk/${versionMajor}`
    if (buildArg === 'test') {
      publishedFileName = `${fileName.slice(
        0,
        fileName.indexOf('.')
      )}-test${fileName.slice(fileName.indexOf('.'))}`
    } else if (buildArg === 'lts') {
      directory += '/LTS'
    } else if (buildArg === 'beta') {
      directory += '/BETA'
    }
    return {
      fileName,
      objectName: `${directory}/${publishedFileName}`
    }
  })
}

module.exports = publishOss
module.exports.getObjectNames = getObjectNames
