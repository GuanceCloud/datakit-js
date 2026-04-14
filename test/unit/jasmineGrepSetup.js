(function () {
  var karma = window.__karma__
  var grep = karma && karma.config && karma.config.grep

  if (!grep || !window.jasmine || !window.jasmine.getEnv) {
    return
  }

  var matcher = createMatcher(grep)
  var env = window.jasmine.getEnv()
  var originalSpecFilter = env.specFilter || function () { return true }

  env.specFilter = function (spec) {
    return originalSpecFilter(spec) && matcher(spec.getFullName())
  }

  function createMatcher(pattern) {
    var regexMatch = pattern.match(/^\/(.+)\/([a-z]*)$/)
    if (regexMatch) {
      var regex = new RegExp(regexMatch[1], regexMatch[2])
      return function (fullName) {
        return regex.test(fullName)
      }
    }

    return function (fullName) {
      return fullName.indexOf(pattern) !== -1
    }
  }
})()
