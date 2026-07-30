import React from 'react'
import { clocksNow, createHandlingStack } from '@cloudcare/browser-core'
import {
  initializeReactPlugin,
  onRumStart,
  startReactPlugin
} from './domain/pluginState'

export function reactPlugin(configuration) {
  if (configuration === undefined) {
    configuration = {}
  }

  return {
    name: 'react',
    onInit: function (context) {
      initializeReactPlugin(configuration, context)
      if (configuration.router) {
        context.initConfiguration.trackViewsManually = true
      }
    },
    onRumStart: function (context) {
      startReactPlugin(context)
    },
    getConfigurationTelemetry: function () {
      return { router: !!configuration.router }
    }
  }
}

export function addReactError(error, errorInfo, context) {
  var providedError = {
    error: error,
    handlingStack: createHandlingStack(),
    context: buildReactErrorContext(error, errorInfo, context),
    startClocks: clocksNow()
  }
  onRumStart(function (addError) {
    addError(providedError)
  })
}

export function createErrorBoundary(reportError, displayName) {
  if (reportError === undefined) {
    reportError = addReactError
  }
  if (displayName === undefined) {
    displayName = 'RumErrorBoundary'
  }

  class RumErrorBoundary extends React.Component {
    constructor(props) {
      super(props)
      this.state = { error: null }
      this.resetError = this.resetError.bind(this)
    }

    static getDerivedStateFromError(error) {
      return { error: error }
    }

    componentDidCatch(error, errorInfo) {
      reportError(error, errorInfo, this.props.context)
      if (this.props.onError) {
        this.props.onError(error, errorInfo)
      }
    }

    resetError() {
      this.setState({ error: null })
      if (this.props.onReset) {
        this.props.onReset()
      }
    }

    render() {
      if (!this.state.error) {
        return this.props.children
      }

      var fallbackProps = {
        error: this.state.error,
        resetError: this.resetError
      }
      if (typeof this.props.fallback === 'function') {
        return React.createElement(this.props.fallback, fallbackProps)
      }
      return this.props.fallback || null
    }
  }

  RumErrorBoundary.displayName = displayName
  return RumErrorBoundary
}

export var ErrorBoundary = createErrorBoundary()

function buildReactErrorContext(error, errorInfo, context) {
  var reactContext = {
    framework: 'react'
  }
  if (errorInfo && errorInfo.componentStack) {
    reactContext.component_stack = errorInfo.componentStack
  }
  if (error && typeof error === 'object' && error.df_context) {
    reactContext = assignContext(reactContext, error.df_context)
  }
  return assignContext(reactContext, context)
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
