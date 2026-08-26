const fs = require('fs')

const RUM_PACKAGE_NAME = '@cloudcare/browser-rum'
const RUM_SLIM_PACKAGE_NAME = '@cloudcare/browser-rum-slim'

function getVersionForcePublishPackages(changedPackages) {
  const changedPackageNames = new Set(
    changedPackages.map((packageDescription) =>
      typeof packageDescription === 'string'
        ? packageDescription
        : packageDescription.name
    )
  )

  if (
    changedPackageNames.has(RUM_PACKAGE_NAME) &&
    !changedPackageNames.has(RUM_SLIM_PACKAGE_NAME)
  ) {
    return [RUM_SLIM_PACKAGE_NAME]
  }

  return []
}

if (require.main === module) {
  const input = fs.readFileSync(0, 'utf8').trim()
  const changedPackages = input ? JSON.parse(input) : []
  process.stdout.write(getVersionForcePublishPackages(changedPackages).join(','))
}

module.exports = { getVersionForcePublishPackages }
