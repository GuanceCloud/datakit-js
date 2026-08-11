const path = require('path')
const webpackBase = require('../../webpack.base')

module.exports = (env, args) => {
  const config = webpackBase({
    mode: args.mode,
    compressPasses: args.mode === 'production' ? 2 : undefined,
    mangleTopLevel: args.mode === 'production',
    // Only package-private `$r*` fields may be mangled. Every capability and
    // host option crosses an independently built bundle boundary.
    propertyMangleRegex: /^\$r[A-Z].*/,
    entry: path.resolve(__dirname, 'src/entries/cdn.js'),
    filename: 'dataflux-rum-webgl.js',
    path:
      args.mode === 'development'
        ? path.resolve(__dirname, 'demo')
        : path.resolve(__dirname, 'bundle')
  })

  return config
}
