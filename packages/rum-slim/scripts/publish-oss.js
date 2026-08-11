const runOss = require('../../../scripts/publish-oss-base')
const { runMain } = require('../../../scripts/utils')

runMain(() =>
  runOss({
    filename: 'dataflux-rum-slim'
  })
)
