const path = require('path')
const webpackBase = require('../../webpack.base')
module.exports = (env, args) =>
  webpackBase({
    mode: args.mode,
    filename: 'worker.js',
    entry: path.resolve(__dirname, 'src/index.js'),
    path: path.resolve(__dirname, 'bundle')
  })
