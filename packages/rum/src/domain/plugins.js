import {
  assign,
  catchUserErrors,
  display,
  each,
  getType,
  isArray
} from '@cloudcare/browser-core'

var PLUGIN_METHODS = [
  'onInit',
  'onRumStart',
  'getConfigurationTelemetry'
]

export function validatePlugins(plugins) {
  if (plugins === undefined) {
    return true
  }
  if (!isArray(plugins)) {
    display.error('Plugins should be an array')
    return false
  }

  for (var i = 0; i < plugins.length; i += 1) {
    var plugin = plugins[i]
    if (
      !plugin ||
      getType(plugin.name) !== 'string' ||
      plugin.name.length === 0
    ) {
      display.error('Plugins should have a non-empty string name')
      return false
    }

    for (
      var methodIndex = 0;
      methodIndex < PLUGIN_METHODS.length;
      methodIndex += 1
    ) {
      var methodName = PLUGIN_METHODS[methodIndex]
      if (
        plugin[methodName] !== undefined &&
        getType(plugin[methodName]) !== 'function'
      ) {
        display.error(
          'Plugin ' + plugin.name + ' has an invalid ' + methodName + ' method'
        )
        return false
      }
    }
  }

  return true
}

export function callPluginsMethod(plugins, methodName, parameter) {
  if (!plugins) {
    return
  }

  each(plugins, function (plugin) {
    var method = plugin[methodName]
    if (getType(method) !== 'function') {
      return
    }
    catchUserErrors(
      function () {
        return method.call(plugin, parameter)
      },
      plugin.name + ' plugin ' + methodName + ' threw an error:'
    )()
  })
}

export function getPluginsTelemetry(plugins) {
  var telemetry = []
  each(plugins || [], function (plugin) {
    var pluginTelemetry = { name: plugin.name }
    if (getType(plugin.getConfigurationTelemetry) === 'function') {
      var configurationTelemetry = catchUserErrors(
        function () {
          return plugin.getConfigurationTelemetry()
        },
        plugin.name + ' plugin getConfigurationTelemetry threw an error:'
      )()
      if (getType(configurationTelemetry) === 'object') {
        pluginTelemetry = assign(pluginTelemetry, configurationTelemetry)
      }
    }
    telemetry.push(pluginTelemetry)
  })
  return telemetry
}
