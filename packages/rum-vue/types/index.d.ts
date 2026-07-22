import type { Context } from '@cloudcare/browser-core'

export interface RumPluginApi {
  startView: (
    options?: string | { name?: string; url?: string; context?: Context }
  ) => void
  addError: (error: unknown, context?: Context) => void
}

export interface VueComponentInstance {
  $?: VueComponentInstance
  type?: { name?: string; __name?: string }
  parent?: VueComponentInstance | null
  $options?: { name?: string; _componentTag?: string }
  $parent?: VueComponentInstance | null
}

export interface VueApp {
  config: {
    errorHandler?: (
      error: unknown,
      instance: VueComponentInstance | null,
      info: string
    ) => unknown
  }
}

export interface VueRouteRecord {
  path?: string
}

export interface VueRoute {
  path?: string
  fullPath?: string
  hash?: string
  meta?: { rumViewName?: string }
  matched?: VueRouteRecord[]
}

export interface VueRouter {
  currentRoute?: VueRoute | { value: VueRoute }
  afterEach: (
    callback: (to: VueRoute, from?: VueRoute, failure?: unknown) => void
  ) => unknown
}

export interface VuePluginConfiguration {
  app?: VueApp
  router?: boolean | VueRouter
  getViewName?: (route: VueRoute) => string | undefined
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

export declare function vuePlugin(
  configuration?: VuePluginConfiguration
): RumPlugin
export declare function addVueError(
  error: unknown,
  instance?: VueComponentInstance | null,
  info?: string,
  context?: Context
): void
export declare function installVueErrorHandler(
  app: VueApp,
  rum?: RumPluginApi
): (() => void) | undefined
export declare function trackVueRouter(
  router: VueRouter,
  rum: RumPluginApi,
  options?: VuePluginConfiguration
): unknown
export declare function wrapCreateVueRouter<T extends (...args: any[]) => VueRouter>(
  createRouter: T,
  options?: VuePluginConfiguration
): T
export declare function computeVueRouterViewName(
  matched: VueRouteRecord[],
  path: string
): string
/** @internal */
export declare function resetVuePlugin(): void
