const TerserPlugin = require('terser-webpack-plugin')
const webpack = require('webpack')
const { buildEnvKeys, getBuildEnvValue } = require('./scripts/build-env')
module.exports = ({
  entry,
  mode,
  path,
  filename,
  types,
  keepBuildEnvVariables
}) => ({
  entry,
  mode,
  output: {
    filename,
    path
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
  module: {
    rules: [
      {
        test: /\.(?:js|mjs|cjs)$/,
        exclude: /node_modules/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
            plugins: ['@babel/plugin-transform-runtime']
          }
        }
      }
    ]
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin(
      mode === 'development'
        ? // Use an inline source map during development (default options)
          {}
        : // When bundling for release, produce a source map file so it can be used for source code integration,
          // but don't append the source map comment to bundles as we don't upload the source map to
          // the CDN (yet).
          {
            filename: '[file].map',
            append: false
          }
    ),
    new webpack.DefinePlugin(
      Object.fromEntries(
        buildEnvKeys
          .filter((key) => !keepBuildEnvVariables?.includes(key))
          .map((key) => [
            `__BUILD_ENV__${key}__`,
            webpack.DefinePlugin.runtimeValue(() =>
              JSON.stringify(getBuildEnvValue(key, mode))
            )
          ])
      )
    )
  ]
})
