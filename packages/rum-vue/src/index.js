import { clocksNow, createHandlingStack } from '@cloudcare/browser-core'
import {
  initializeVuePlugin,
  onRumStart,
  startVuePlugin
} from './domain/pluginState'

export function vuePlugin(configuration) {
  if (configuration === undefined) {
    configuration = {}
  }

  return {
    name: 'vue',
    onInit: function (context) {
      initializeVuePlugin(configuration, context)
      if (configuration.router) {
        context.initConfiguration.trackViewsManually = true
      }
      if (configuration.app) {
        installVueErrorHandler(configuration.app)
      }
    },
    onRumStart: function (context) {
      startVuePlugin(context)
    },
    getConfigurationTelemetry: function () {
      return { router: !!configuration.router }
    }
  }
}

export function addVueError(error, instance, info, context) {
  var providedError = {
    error: error,
    handlingStack: createHandlingStack(),
    context: buildVueErrorContext(error, instance, info, context),
    startClocks: clocksNow()
  }
  onRumStart(function (addError) {
    addError(providedError)
  })
}

export function installVueErrorHandler(app, rum) {
  if (!app || !app.config) {
    return
  }

  var previousErrorHandler = app.config.errorHandler
  var errorHandler = function (error, instance, info) {
    if (rum) {
      rum.addError(error, buildVueErrorContext(error, instance, info))
    } else {
      addVueError(error, instance, info)
    }
    if (typeof previousErrorHandler === 'function') {
      return previousErrorHandler.call(this, error, instance, info)
    }
  }
  app.config.errorHandler = errorHandler

  return function () {
    if (app.config.errorHandler === errorHandler) {
      app.config.errorHandler = previousErrorHandler
    }
  }
}

function buildVueErrorContext(error, instance, info, context) {
  var vueContext = {
    framework: 'vue',
    component_stack: buildComponentStack(instance, info)
  }
  if (error && typeof error === 'object' && error.df_context) {
    vueContext = assignContext(vueContext, error.df_context)
  }
  return assignContext(vueContext, context)
}

function buildComponentStack(instance, info) {
  var parts = []
  if (info) {
    parts.push(info)
  }

  var current = instance && (instance.$ || instance)
  while (current) {
    var type = current.type || current.$options || {}
    var name = type.name || type.__name || type._componentTag
    if (name) {
      parts.push('at <' + name + '>')
    }
    current = current.parent || current.$parent
  }
  return parts.length ? parts.join('\n') : undefined
}

function assignContext(base, extra) {
  if (!extra) {
    return base
  }
  var result = {}
  var key
  for (key in base) {
    result[key] = base[key]
  }
  for (key in extra) {
    result[key] = extra[key]
  }
  return result
}
