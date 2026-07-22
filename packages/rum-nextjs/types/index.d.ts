import type { Context } from '@cloudcare/browser-core'
import type { NextRouter } from 'next/router'
import type * as React from 'react'
import type {
  ErrorBoundaryProps as ReactErrorBoundaryProps,
  RumPluginError,
  RumPluginApi
} from '@cloudcare/browser-rum-react'

export type ErrorBoundaryProps = ReactErrorBoundaryProps

export interface NextjsPluginConfiguration {
  router?: NextRouter
  getViewName?: (url: string, router: NextRouter) => string | undefined
}

export interface RumPlugin {
  name: string
  onInit?: (context: {
    addError: (error: RumPluginError) => void
    publicApi: RumPluginApi
    rum: RumPluginApi
    initConfiguration: {
      trackViewsManually?: boolean
    }
  }) => void
  onRumStart?: (context: {
    addError: (error: RumPluginError) => void
    publicApi: RumPluginApi
    rum: RumPluginApi
  }) => void
  getConfigurationTelemetry?: () => Record<string, unknown>
}

export interface NextjsErrorInfo extends Partial<React.ErrorInfo> {
  digest?: string
}

export declare function nextjsPlugin(
  configuration?: NextjsPluginConfiguration
): RumPlugin
export declare function onRouterTransitionStart(url: string): void
export declare function startNextjsView(
  viewName?: string,
  url?: string,
  rum?: RumPluginApi
): void
export declare function addNextjsError(
  error: unknown,
  errorInfo?: NextjsErrorInfo,
  context?: Context
): void
export declare const ErrorBoundary: React.ComponentClass<ErrorBoundaryProps>
export declare function RumNextjsAppRouter(): null
export declare function RumNextjsPagesRouter(): null
export declare function trackNextjsRouter(
  router: NextRouter,
  rum: RumPluginApi,
  options?: NextjsPluginConfiguration
): unknown
export declare function computeViewNameFromParams(
  pathname: string,
  params: Record<string, string | string[] | undefined>
): string
/** @internal */
export declare function resetNextjsPlugin(): void
