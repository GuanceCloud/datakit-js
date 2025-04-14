const path = require('path')
const webpackBase = require('../../webpack.base')
module.exports = (env, args) =>
  webpackBase({
    mode: args.mode,
    filename: 'dataflux-logs.js',
    entry: path.resolve(__dirname, 'src/index.js'),
    path:
      args.mode === 'development'
        ? path.resolve(__dirname, 'demo')
        : path.resolve(__dirname, 'bundle')
  })
