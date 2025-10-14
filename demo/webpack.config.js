const TerserPlugin = require('terser-webpack-plugin')
const { SourceMapUploadWebpackPlugin } = require('@cloudcare/webpack-plugin')
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
    new SourceMapUploadWebpackPlugin({
      applicationId: 'dcl_test_longtask',
      apiKey: 'p7YK53AvcIFyHRPnbfrhQXxkdWS8j09e',
      server: 'http://testing-ft2x-open-api.dataflux.cn',
      filepaths: ['build/'],
      logLevel: 'verbose',
      root: 'build/',
      env: 'production',
      version: '1.0.0'
      //   deleteAfterUpload: true,
    }),
    new webpack.SourceMapDevToolPlugin({
      filename: '[file].map',
      append: '\n//# sourceMappingURL=[url]'
    })
  ]
})
