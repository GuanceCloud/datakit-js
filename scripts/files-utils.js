const path = require('path')
const fsPromises = require('fs/promises')

const { command } = require('./command')

/**
 * @param filePath {string}
 * @param modifier {(content: string) => string}
 */
async function modifyFile(filePath, modifier) {
  const content = await fsPromises.readFile(filePath, { encoding: 'utf-8' })
  const modifiedContent = modifier(content)
  if (content !== modifiedContent) {
    await fsPromises.writeFile(filePath, modifiedContent)
    return true
  }
  return false
}

function findBrowserSdkPackageJsonFiles() {
  const manifestPaths =
    command`git ls-files -- package.json */package.json`.run()
  return manifestPaths
    .trim()
    .split('\n')
    .map((manifestPath) => {
      const absoluteManifestPath = path.join(__dirname, '../..', manifestPath)
      return {
        relativePath: manifestPath,
        path: absoluteManifestPath,
        content: require(absoluteManifestPath)
      }
    })
}

module.exports = {
  modifyFile,
  findBrowserSdkPackageJsonFiles
}
