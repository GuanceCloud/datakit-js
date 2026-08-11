(function () {
  var karma = window.__karma__
  var grep = karma && karma.config && karma.config.grep

  if (!grep || typeof karma.start !== 'function') {
    return
  }

  var originalStart = karma.start
  karma.start = function () {
    // karma-jasmine installs the final specFilter inside start(). Feed its
    // supported --grep argument instead of configuring Jasmine too early and
    // having that filter overwritten immediately before execute().
    var args = karma.config.args || []
    karma.config.args = args.concat(['--grep', grep])
    return originalStart.apply(this, arguments)
  }
})()
