import type { ErrorHandler } from '@angular/core'
import type { Context } from '@cloudcare/browser-core'

export interface RumPluginApi {
  startView: (
    options?: string | { name?: string; url?: string; context?: Context }
  ) => void
  addError: (error: unknown, context?: Context) => void
}

export interface AngularRouteSnapshot {
  routeConfig?: { path?: string } | null
  children?: AngularRouteSnapshot[]
  outlet?: string
  url?: Array<{ path: string }>
}

export interface AngularRouterEvent {
  type?: string | number
  shouldActivate?: boolean
  url?: string
  urlAfterRedirects?: string
  state?: { root?: AngularRouteSnapshot }
}

export interface AngularRouter {
  events: {
    subscribe: (callback: (event: AngularRouterEvent) => void) => unknown
  }
  navigated?: boolean
  url?: string
  routerState?: {
    snapshot?: { root?: AngularRouteSnapshot }
  }
}

export interface AngularPluginConfiguration {
  router?: boolean | AngularRouter
  getViewName?: (
    root: AngularRouteSnapshot | undefined,
    url: string
  ) => string | undefined
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

export interface RumPluginError {
  error: unknown
  handlingStack?: string
  context?: Context
  startClocks: {
    relative: number
    timeStamp: number
  }
}

export declare function angularPlugin(
  configuration?: AngularPluginConfiguration
): RumPlugin
export declare function addAngularError(
  error: unknown,
  context?: Context
): void
export declare class RumAngularErrorHandler implements ErrorHandler {
  constructor(delegate?: ErrorHandler)
  handleError(error: unknown): void
}
export declare function createAngularErrorHandler(
  delegate?: ErrorHandler
): RumAngularErrorHandler
export declare function trackAngularRouter(
  router: AngularRouter,
  rum?: RumPluginApi,
  options?: AngularPluginConfiguration
): unknown
export declare function computeAngularViewName(
  root?: AngularRouteSnapshot
): string
/** @internal */
export declare function resetAngularPlugin(): void
