const path = require('path')
const karmaBaseConf = require('./karma.base.conf')

module.exports = function (config) {
  config.set({
    ...karmaBaseConf,
    reporters: ['coverage-istanbul', ...karmaBaseConf.reporters],
    browsers: ['ChromeHeadlessNoSandbox'],
    coverageIstanbulReporter: {
      reports: ['html', 'text-summary', 'json'],
      dir: path.join(__dirname, '../../coverage')
    },
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox']
      }
    },
    webpack: {
      ...karmaBaseConf.webpack,
      module: withIstanbulRule({ rules: [] })
    }
  })
}

function withIstanbulRule(module) {
  module.rules.push({
    test: /^.*\.js$/,
    exclude: [/.*\.spec\.js$/, /node_modules/],
    enforce: 'post',
    use: {
      loader: '@jsdevtools/coverage-istanbul-loader',
      options: {
        esModules: true
      }
    }
  })
  return module
}
