const fs = require('fs')
const path = require('path')

const targetDirectory = process.argv[2]

if (!targetDirectory) {
  console.error(
    'Usage: node scripts/strip-source-map-sources-content.js <directory>'
  )
  process.exit(1)
}

const resolvedTargetDirectory = path.resolve(targetDirectory)
if (!fs.existsSync(resolvedTargetDirectory)) {
  console.error(`Source map directory not found: ${resolvedTargetDirectory}`)
  process.exit(1)
}

let strippedSourceMapCount = 0
stripSourceMaps(resolvedTargetDirectory)
console.log(
  `Removed embedded sources from ${strippedSourceMapCount} source maps in ${path.relative(
    process.cwd(),
    resolvedTargetDirectory
  )}`
)

function stripSourceMaps(directory) {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const entryPath = path.join(directory, entry.name)
    if (entry.isDirectory()) {
      stripSourceMaps(entryPath)
      return
    }
    if (!entry.isFile() || !entry.name.endsWith('.map')) {
      return
    }

    const sourceMap = JSON.parse(fs.readFileSync(entryPath, 'utf8'))
    if (!Object.prototype.hasOwnProperty.call(sourceMap, 'sourcesContent')) {
      return
    }
    delete sourceMap.sourcesContent
    fs.writeFileSync(entryPath, JSON.stringify(sourceMap))
    strippedSourceMapCount += 1
  })
}
