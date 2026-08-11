const path = require('path')
const webpackBase = require('../../webpack.base')
module.exports = (env, args) => {
  const config = webpackBase({
    mode: args.mode,
    compressPasses: args.mode === 'production' ? 2 : undefined,
    compressInline: args.mode === 'production' ? 1 : undefined,
    mangleTopLevel: args.mode === 'production',
    propertyMangleBuiltins: args.mode === 'production',
    entry: path.resolve(__dirname, 'src/index.js'),
    filename: 'dataflux-rum.js',
    path:
      args.mode === 'development'
        ? path.resolve(__dirname, 'demo')
        : path.resolve(__dirname, 'bundle')
  })

  // Bundle Core from its source entry, as rum-slim already does.  Consuming
  // Core's pre-transpiled ESM here makes Babel helpers and compatibility
  // scaffolding opaque to the final RUM optimization pass.
  config.resolve.alias = {
    ...config.resolve.alias,
    '@cloudcare/browser-core$': path.resolve(
      __dirname,
      '../core/src/index.js'
    )
  }
  return config
}
