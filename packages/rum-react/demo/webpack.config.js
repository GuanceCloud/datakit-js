const path = require('path')

const reactDirectory = path.resolve(__dirname, '../node_modules/react')
const reactDomDirectory = path.resolve(__dirname, '../node_modules/react-dom')

module.exports = (env, args) => ({
  mode: args.mode,
  entry: path.resolve(__dirname, 'index.js'),
  output: {
    filename: 'bundle.js',
    path: path.resolve(__dirname, 'dist'),
    publicPath: '/framework-react/'
  },
  resolve: {
    alias: {
      '@cloudcare/browser-core$': path.resolve(__dirname, '../../core/src/index.js'),
      'react$': path.resolve(reactDirectory, 'index.js'),
      'react/jsx-runtime$': path.resolve(reactDirectory, 'jsx-runtime.js'),
      'react/jsx-dev-runtime$': path.resolve(reactDirectory, 'jsx-dev-runtime.js'),
      'react-dom$': path.resolve(reactDomDirectory, 'index.js'),
      'react-dom/client$': path.resolve(reactDomDirectory, 'client.js')
    }
  },
  devtool: 'source-map',
  target: 'web'
})
