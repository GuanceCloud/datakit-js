const TerserPlugin = require('terser-webpack-plugin')
const webpack = require('webpack')
const path = require('path')
module.exports = (env, args) => ({
  entry: path.resolve(__dirname, 'static/test.js'),
  mode: args.mode,
  output: {
    filename: 'test-sourcemap.js',
    path: path.resolve(__dirname, 'build')
  },
  target: ['web', 'es5'],
  devtool: false,
  optimization: {
    minimizer: [
      new TerserPlugin({
        extractComments: false
      })
    ]
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      filename: '[file].map',
      append: '\n//# sourceMappingURL=[url]'
    })
  ]
})
