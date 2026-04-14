const path = require('path')
const webpackConfig = require('../../webpack.base')({
  mode: 'development',
  types: ['jasmine', 'chrome'],
  // do not replace some build env variables in unit test in order to test different build behaviors
  keepBuildEnvVariables: ['SDK_VERSION']
})
const jasmineSeedReporterPlugin = require('./jasmineSeedReporterPlugin')

const reporters = ['spec', 'jasmine-seed']
const DEFAULT_SPEC_PATTERN = 'packages/*/+(src|test)/**/*.spec.js'

function getSpecPatterns() {
  const rawSpecPattern = process.env.KARMA_SPEC_PATTERN
  if (!rawSpecPattern) {
    return [DEFAULT_SPEC_PATTERN]
  }

  return rawSpecPattern
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
}

module.exports = {
  basePath: '../..',
  files: [
    'test/unit/jasmineGrepSetup.js',
    ...getSpecPatterns()
  ],
  frameworks: ['jasmine', 'webpack'],
  client: {
    grep: process.env.KARMA_GREP || '',
    jasmine: {
      random: true,
      stopSpecOnExpectationFailure: true
    }
  },
  preprocessors: {
    'packages/*/+(src|test)/**/*.js': ['webpack', 'sourcemap']
  },
  reporters,
  specReporter: {
    suppressErrorSummary: true,
    suppressPassed: true,
    suppressSkipped: true
  },

  singleRun: true,
  webpack: {
    stats: 'minimal',
    target: webpackConfig.target,
    devtool: false,
    mode: 'development',
    plugins: webpackConfig.plugins,
    resolve: {
      alias: {
        '@cloudcare/browser-core$': path.resolve(
          __dirname,
          '../../packages/core/src/index.js'
        ),
        '@cloudcare/browser-core/worker$': path.resolve(
          __dirname,
          '../../packages/core/src/worker.js'
        ),
        '@cloudcare/browser-worker$': path.resolve(
          __dirname,
          '../../packages/worker/src/index.js'
        )
      }
    },
    optimization: {
      // By default, karma-webpack creates a bundle with one entry point for each spec file, but
      // with all dependencies shared.  Our test suite does not support sharing dependencies, each
      // spec bundle should include its own copy of dependencies.
      runtimeChunk: false,
      splitChunks: false
    }
  },
  webpackMiddleware: {
    stats: 'errors-only',
    logLevel: 'warn'
  },
  plugins: ['karma-*', jasmineSeedReporterPlugin],

  // Running tests on low performance environments (ex: BrowserStack) can block JS execution for a
  // few seconds. We need to increase those two timeout values to make sure Karma (and underlying
  // Socket.io) does not consider that the browser crashed.
  pingTimeout: 60_000,
  browserNoActivityTimeout: 60_000
}
