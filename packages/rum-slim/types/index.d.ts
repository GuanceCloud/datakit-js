import type {
  Context,
  RumInitConfiguration,
  RumSiteInitConfiguration,
  User
} from '@cloudcare/browser-core'

export interface InternalContext {
  application: {
    id: string
  }
  session: {
    id: string | undefined
  }
  view?: {
    id: string
    url: string
    referrer: string
    name?: string
    host: string
    path: string
    urlQuery: string
    pathGroup: string
    pathname: string
  }
  userAction?: {
    id: string
    ids: string[]
  }
}

export interface StartSessionOptions {
  /**
   * Overrides the runtime RUM session sample rate for the new session and
   * subsequent automatic session renewals.
   */
  sessionSampleRate?: number
}

export interface ResourceTrackerSnapshot {
  trackerId: string
  status:
    | 'created'
    | 'request_collected'
    | 'finished'
    | 'flushed'
    | 'timeout_flushed'
    | 'cleared'
  context: Context
  resource?:
    | {
        type?: string
        url?: string
        method?: string
        status?: number
      }
    | undefined
  rawRumEvent?: object | undefined
}

export interface ViewOptions {
  name?: string | undefined
  service?: string | undefined
  version?: string | undefined
  url?: string | undefined
  context?: Context | undefined
}

export interface RumPluginApi {
  startView: (options?: string | ViewOptions) => void
  setViewName: (name: string) => void
  setViewContext: (context: Context) => void
  setViewContextProperty: (key: string, value: any) => void
  addAction: (name: string, context?: object | undefined) => void
  addTypeAction: (
    name: string,
    type?: string,
    context?: object | undefined
  ) => void
  addError: (error: unknown, context?: object | undefined) => void
  getInternalContext: (
    startTime?: number | undefined
  ) => InternalContext | undefined
}

export interface RumPluginContext {
  addError: (error: RumPluginError) => void
  publicApi: RumPluginApi
  rum: RumPluginApi
  initConfiguration: RumSlimPluginInitConfiguration
}

export interface RumPluginStartContext {
  addError: (error: RumPluginError) => void
  publicApi: RumPluginApi
  rum: RumPluginApi
}

export interface RumPluginError {
  error: unknown
  handlingStack?: string | undefined
  context?: Context | undefined
  startClocks: {
    relative: number
    timeStamp: number
  }
}

export interface RumPlugin {
  name: string
  onInit?: (context: RumPluginContext) => void
  onRumStart?: (context: RumPluginStartContext) => void
  getConfigurationTelemetry?: () => Record<string, unknown>
}

type RumSlimUnsupportedInitOption =
  | 'sessionReplaySampleRate'
  | 'sessionReplayOnErrorSampleRate'
  | 'workerUrl'
  | 'replayCanvasWorkerUrl'
  | 'compressIntakeRequests'
  | 'shouldMaskNode'
  | 'replayCanvasEnabled'
  | 'replayCanvasMode'
  | 'replayCanvasSampling'
  | 'replayCanvasMimeType'
  | 'replayCanvasQuality'
  | 'replayCanvasMaxCanvasSize'
  | 'replayCanvasMaxEncodedBytes'
  | 'replayCanvasMaxConcurrentEncodes'
  | 'replayCanvasFlushImmediately'
  | 'replayCanvasAutoInterval'
  | 'replayCanvasAutoCooldown'
  | 'replayCanvasAutoUnchangedBackoff'
  | 'replayCanvasAutoFailureBackoff'
  | 'replayCanvasAutoMaxPerRun'
  | 'shouldRecordCanvas'

export type RumSlimInitConfiguration = Omit<
  RumInitConfiguration,
  RumSlimUnsupportedInitOption
>
export type RumSlimSiteInitConfiguration = Omit<
  RumSiteInitConfiguration,
  RumSlimUnsupportedInitOption
>
export type RumSlimPluginInitConfiguration = (
  | RumSlimInitConfiguration
  | RumSlimSiteInitConfiguration
) & {
  plugins?: RumPlugin[] | undefined
}

export declare const datafluxRum: {
  init: (initConfiguration: RumSlimPluginInitConfiguration) => void
  startView: (options?: string | ViewOptions) => void
  setViewName: (name: string) => void
  setViewContext: (context: Context) => void
  setViewContextProperty: (key: string, value: any) => void
  getViewContext: () => Context
  setGlobalContextProperty: (key: any, value: any) => void
  addRumGlobalContext: (key: any, value: any) => void
  removeGlobalContextProperty: (key: any) => void
  removeRumGlobalContext: (key: any) => void
  getGlobalContext: () => Context
  setGlobalContext: (context: any) => void
  clearGlobalContext: () => void
  getInternalContext: (
    startTime?: number | undefined
  ) => InternalContext | undefined
  getInitConfiguration: () =>
    | RumSlimPluginInitConfiguration
    | undefined
  getRemoteConfiguration: (
    callback: (remoteConfiguration: object) => void
  ) => undefined
  addResource: (context?: object | undefined) => void
  addAction: (name: string, context?: object | undefined) => void
  addTypeAction: (
    name: string,
    type?: string,
    context?: object | undefined
  ) => void
  addError: (error: unknown, context?: object | undefined) => void
  addTiming: (name: string, time?: number | undefined) => void
  setUser: (newUser: User) => void
  getUser: () => Context
  setUserProperty: (key: any, property: any) => void
  removeUserProperty: (key: any) => void
  clearUser: () => void
  stopSession: () => void
  startSession: (options?: StartSessionOptions) => void
  setForcedSession: () => void
  createResourceTrackerId: () => string
  setResourceContext: (trackerId: string, context: Context) => void
  appendResourceContext: (trackerId: string, context: Context) => void
  finishResource: (trackerId: string) => void
  getResource: (trackerId: string) => ResourceTrackerSnapshot | undefined
} & {
  onReady(callback: () => void): void
}
