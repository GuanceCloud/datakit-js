const TerserPlugin = require('terser-webpack-plugin')
const webpack = require('webpack')
const path = require('path')
module.exports = (env, args) => ({
  entry: path.resolve(__dirname, 'index.js'),
  mode: args.mode,
  output: {
    filename: 'index.js',
    path: path.resolve(__dirname, 'dist')
  },
  target: ['web', 'es5'],
  devtool: false,
  optimization: {
    minimizer: [
      new TerserPlugin({
        extractComments: false
      })
    ]
  }
})
