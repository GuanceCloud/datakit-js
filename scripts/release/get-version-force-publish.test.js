const assert = require('assert')

const {
  getVersionForcePublishPackages
} = require('./get-version-force-publish')

const RUM_PACKAGE_NAME = '@cloudcare/browser-rum'
const RUM_SLIM_PACKAGE_NAME = '@cloudcare/browser-rum-slim'

assert.deepStrictEqual(
  getVersionForcePublishPackages([{ name: RUM_PACKAGE_NAME }]),
  [RUM_SLIM_PACKAGE_NAME],
  'RUM source releases must include the Slim package built from the same source'
)

assert.deepStrictEqual(
  getVersionForcePublishPackages([
    { name: RUM_PACKAGE_NAME },
    { name: RUM_SLIM_PACKAGE_NAME }
  ]),
  [],
  'Slim must not be forced when Lerna already detected it as changed'
)

assert.deepStrictEqual(
  getVersionForcePublishPackages([{ name: '@cloudcare/browser-logs' }]),
  [],
  'Unrelated package releases must not force a Slim release'
)

assert.deepStrictEqual(
  getVersionForcePublishPackages([RUM_PACKAGE_NAME]),
  [RUM_SLIM_PACKAGE_NAME],
  'Package names are accepted for direct unit testing'
)

console.log('Version force-publish checks passed')
