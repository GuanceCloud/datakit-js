const path = require('path')
const webpackBase = require('../../webpack.base')
module.exports = (env, args) =>
  webpackBase({
    mode: args.mode,
    filename: '[name].js',
    entry: {
      worker: path.resolve(__dirname, 'src/index.js'),
      'canvas-worker': path.resolve(__dirname, 'src/canvasWorker.js')
    },
    path: path.resolve(__dirname, 'bundle')
  })
