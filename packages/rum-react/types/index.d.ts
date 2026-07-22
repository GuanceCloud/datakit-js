import type { Context } from '@cloudcare/browser-core'
import type * as React from 'react'

export interface RumPluginApi {
  startView: (
    options?: string | { name?: string; url?: string; context?: Context }
  ) => void
  setViewName: (name: string) => void
  addError: (error: unknown, context?: Context) => void
}

export interface RumPluginContext {
  addError: (error: RumPluginError) => void
  publicApi: RumPluginApi
  rum: RumPluginApi
  initConfiguration: {
    trackViewsManually?: boolean
  }
}

export interface RumPluginError {
  error: unknown
  handlingStack?: string
  context?: Context
  startClocks: {
    relative: number
    timeStamp: number
  }
}

export interface RumPlugin {
  name: string
  onInit?: (context: RumPluginContext) => void
  onRumStart?: (context: {
    addError: (error: RumPluginError) => void
    publicApi: RumPluginApi
    rum: RumPluginApi
  }) => void
  getConfigurationTelemetry?: () => Record<string, unknown>
}

export interface ReactRouterLocation {
  pathname?: string
  search?: string
  hash?: string
}

export interface ReactRouteMatch {
  route?: { path?: string }
  path?: string
  params?: Record<string, string | undefined>
}

export interface ReactRouterState {
  location?: ReactRouterLocation
  matches?: ReactRouteMatch[]
}

export interface ReactRouter {
  state?: ReactRouterState
  location?: ReactRouterLocation
  subscribe?: (callback: (state: ReactRouterState) => void) => unknown
  listen?: (callback: (update: ReactRouterState) => void) => unknown
}

export interface ReactPluginConfiguration {
  router?: boolean | ReactRouter
  getViewName?: (
    location: ReactRouterLocation | string | undefined,
    matches?: ReactRouteMatch[]
  ) => string | undefined
}

export interface ErrorBoundaryFallbackProps {
  error: Error
  resetError: () => void
}

export interface ErrorBoundaryProps {
  fallback?: React.ComponentType<ErrorBoundaryFallbackProps> | React.ReactNode
  children?: React.ReactNode
  context?: Context
  onError?: (error: Error, errorInfo: React.ErrorInfo) => void
  onReset?: () => void
}

export declare function reactPlugin(
  configuration?: ReactPluginConfiguration
): RumPlugin
export declare function addReactError(
  error: unknown,
  errorInfo?: React.ErrorInfo,
  context?: Context
): void
export declare function createErrorBoundary(
  reportError?: (
    error: Error,
    errorInfo: React.ErrorInfo,
    context?: Context
  ) => void,
  displayName?: string
): React.ComponentClass<ErrorBoundaryProps>
export declare const ErrorBoundary: React.ComponentClass<ErrorBoundaryProps>
export declare function trackReactRouter(
  router: ReactRouter,
  rum: RumPluginApi,
  options?: ReactPluginConfiguration
): unknown
export declare function wrapCreateReactRouter<T extends (...args: any[]) => ReactRouter>(
  createRouter: T,
  options?: ReactPluginConfiguration
): T
export declare function computeReactRouterViewName(
  matches?: ReactRouteMatch[],
  fallbackPathname?: string
): string
/** @internal */
export declare function resetReactPlugin(): void
