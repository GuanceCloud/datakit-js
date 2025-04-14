const OSS = require('ali-oss')
const fs = require('fs')
const path = require('path')
const { printError, printLog } = require('./utils')

const packageJSON = require('../lerna.json')
const configJson = require('../config/config.json')
let sdkVersion = packageJSON.version
// publish-oss-base.js
module.exports = ({ filename }) => {
  if (!configJson) {
    printError('load oss config fail')
    return
  }
  const { region, accessKeyId, accessKeySecret, bucket } = configJson.oss
  const client = new OSS({
    region,
    accessKeyId,
    accessKeySecret,
    bucket
  })
  const files = [`${filename}.js`, `${filename}.js.map`]
  files.forEach((name) => {
    const fullpath = path.resolve('./bundle', name)
    const jscontent = fs.readFileSync(fullpath)
    const buildArg = process.argv[2]
    // 获取大版本信息
    const versionMajor = `v${sdkVersion.split('.')[0]}`
    let objectName = ''
    if (buildArg === 'test') {
      // 测试版本
      name = `${name.slice(0, name.indexOf('.'))}-test${name.slice(
        name.indexOf('.')
      )}`
      objectName = `browser-sdk/${versionMajor}/${name}`
    } else if (buildArg === 'lts') {
      // LTS 版本
      objectName = `browser-sdk/${versionMajor}/LTS/${name}`
    } else if (buildArg === 'current') {
      // Current 版本
      objectName = `browser-sdk/${versionMajor}/${name}`
    } else if (buildArg === 'beta') {
      // beta 版本
      objectName = `browser-sdk/${versionMajor}/BETA/${name}`
    }
    printLog('file publish oss:', objectName)
    if (!objectName) return
    client
      .put(objectName, jscontent, {
        mime: 'application/javascript'
      })
      .then((result) => {
        // flushCdn()
      })
      .catch((err) => {
        printError('file publish oss fail:', err)
      })
  })
}
