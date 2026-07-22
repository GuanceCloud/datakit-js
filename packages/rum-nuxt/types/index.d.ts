import type { Context } from '@cloudcare/browser-core'

export interface RumPluginApi {
  startView: (
    options?: string | { name?: string; url?: string; context?: Context }
  ) => void
  addError: (error: unknown, context?: Context) => void
}

export interface NuxtComponentInstance {
  $?: NuxtComponentInstance
  type?: { name?: string; __name?: string }
  parent?: NuxtComponentInstance | null
  $options?: { name?: string; _componentTag?: string }
  $parent?: NuxtComponentInstance | null
}

export interface NuxtApp {
  vueApp: {
    config: {
      errorHandler?: (
        error: unknown,
        instance: NuxtComponentInstance | null,
        info: string
      ) => unknown
    }
  }
  hook?: (name: string, callback: (...args: any[]) => void) => unknown
  hooks?: {
    hook?: (name: string, callback: (...args: any[]) => void) => unknown
  }
}

export interface NuxtRouteRecord {
  path?: string
}

export interface NuxtRoute {
  path?: string
  fullPath?: string
  hash?: string
  matched?: NuxtRouteRecord[]
}

export interface NuxtRouter {
  currentRoute?: NuxtRoute | { value: NuxtRoute }
  afterEach: (
    callback: (to: NuxtRoute, from?: NuxtRoute, failure?: unknown) => void
  ) => unknown
}

export interface NuxtPluginConfiguration {
  router: NuxtRouter
  nuxtApp?: NuxtApp
  getViewName?: (route: NuxtRoute) => string | undefined
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

export declare function nuxtRumPlugin(
  configuration: NuxtPluginConfiguration
): RumPlugin
export declare const nuxtPlugin: typeof nuxtRumPlugin
export declare function addNuxtError(
  error: unknown,
  context?: Context
): void
export declare function installNuxtErrorHandler(
  nuxtApp: NuxtApp,
  rum: RumPluginApi
): (() => void) | undefined
export declare function setupNuxtErrorHandling(
  nuxtApp: NuxtApp,
  reportError: (
    error: unknown,
    instance: NuxtComponentInstance | null,
    info: string
  ) => void
): (() => void) | undefined
export declare function startTrackingNuxtViews(
  rum: RumPluginApi,
  router: NuxtRouter,
  options?: NuxtPluginConfiguration
): unknown
export declare function trackNuxtRouter(
  router: NuxtRouter,
  rum: RumPluginApi,
  options?: NuxtPluginConfiguration
): unknown
export declare function computeNuxtViewName(
  matched: NuxtRouteRecord[]
): string
export declare function normalizeNuxtRoutePath(
  path?: string
): string | undefined
/** @internal */
export declare function resetNuxtPlugin(): void
