const path = require('path')
const webpackBase = require('../../webpack.base')

module.exports = (env, args) => {
  const config = webpackBase({
    mode: args.mode,
    entry: path.resolve(__dirname, 'src/index.js'),
    filename: 'dataflux-rum-slim.js',
    path:
      args.mode === 'development'
        ? path.resolve(__dirname, 'demo')
        : path.resolve(__dirname, 'bundle')
  })

  config.resolve.alias = {
    ...config.resolve.alias,
    '@cloudcare/browser-core$': path.resolve(
      __dirname,
      '../core/src/index.js'
    ),
    '@cloudcare/browser-core/worker$': path.resolve(
      __dirname,
      '../core/src/worker.js'
    )
  }
  return config
}
