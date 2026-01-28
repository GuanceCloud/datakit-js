const TerserPlugin = require('terser-webpack-plugin')
const { SourceMapUploadWebpackPlugin } = require('@cloudcare/webpack-plugin')
const webpack = require('webpack')
const path = require('path')
module.exports = (env, args) => ({
  entry: path.resolve(__dirname, 'static/test.js'),
  mode: args.mode,
  output: {
    filename: '[name].js',
    chunkFilename: '[name].js',
    path: path.resolve(__dirname, 'build')
  },
  target: ['web', 'es5'],
  devtool: false,
  optimization: {
    minimizer: [
      new TerserPlugin({
        extractComments: false
      })
    ],
    splitChunks: {
      chunks: 'all'
    },
    runtimeChunk: 'single'
  },
  plugins: [
    new SourceMapUploadWebpackPlugin({
      applicationId: 'test_longtask',
      apiKey: 'eSpWHk7EMdlXKRs60tUOPgv3qVGmoxi2',
      server: 'https://openapi.guance.com',
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
