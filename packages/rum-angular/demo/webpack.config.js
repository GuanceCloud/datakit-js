const path = require('path')

module.exports = (env, args) => ({
  mode: args.mode,
  entry: path.resolve(__dirname, 'index.js'),
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/framework-angular/'
  },
  resolve: {
    alias: {
      '@cloudcare/browser-core$': path.resolve(__dirname, '../../core/src/index.js')
    }
  },
  devtool: 'source-map',
  target: 'web'
})
