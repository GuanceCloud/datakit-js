import type {
  RumInitConfiguration,
  RumSiteInitConfiguration,
  Context,
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

export interface StartSessionReplayRecordingOptions {
  /**
   * Forces the current session to be tracked, assigns a session ID when
   * necessary, and enables Session Replay recording.
   */
  force?: boolean
}

export interface CanvasSnapshotResult {
  ok: boolean
  reason?: string
}

export interface AutoCanvasSnapshotDebugEntry {
  canvasId?: number
  ok: boolean
  reason?: string
  priority?: number | null
}

export interface AutoCanvasSnapshotDebugResult {
  scheduler: 'continuous_snapshot' | 'command_capture' | 'webgl_snapshot'
  status:
    | 'completed'
    | 'fallback'
    | 'skipped_hidden'
    | 'skipped_no_candidates'
  startedAt?: number
  completedAt?: number
  timestamp: number
  eligibleCanvasCount: number
  selectedCanvasCount: number
  skippedBudgetCount: number
  keepSessionAliveTriggered: boolean
  results: AutoCanvasSnapshotDebugEntry[]
}

export interface CanvasMutationDebugResult {
  timestamp: number
  canvasId?: number
  trigger: 'manual' | 'auto'
  reason?: string
  encodedBytesCount?: number
  approxBytesCount?: number
  commandCount?: number
  width?: number
  height?: number
  diagnostics?: {
    mimeType?: string
    dataUrlLength?: number
    base64Length?: number
    base64Prefix?: string
    base64Suffix?: string
    firstPaddingIndex?: number
    firstPaddingWindow?: string
    invalidCharacterIndex?: number
    invalidCharacterWindow?: string
    hasMidstreamPadding?: boolean
  }
}

export interface CanvasMutationDebugHistoryResult
  extends CanvasMutationDebugResult {}

export interface DomMutationDebugResult {
  timestamp: number
  adds: object[]
  removes: object[]
  texts: object[]
  attributes: object[]
  addsCount: number
  removesCount: number
  textsCount: number
  attributesCount: number
}

export interface ReplaySegmentFlushDebugResult {
  sequence: number
  creationReason: string
  flushReason: string
  recordsCount: number
  recordCountsByType: Record<string, number>
  start: number
  end: number
  indexInView: number
  rawBytesCount: number
}

export interface ReplayPerformanceDebugResult {
  processMutationsCount: number
  processMutationsDuration: number
  mutationSerializationCount: number
  mutationSerializationDuration: number
  mutationCallbackCount: number
  mutationRecordCount: number
  mutationAddCount: number
  mutationRemoveCount: number
  mutationTextCount: number
  mutationAttributeCount: number
  fullSnapshotCount: number
  fullSnapshotDuration: number
  replaySegmentFlushCount: number
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
  initConfiguration: RumPluginInitConfiguration
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

export type RumPluginInitConfiguration = (
  | RumInitConfiguration
  | RumSiteInitConfiguration
) & {
  plugins?: RumPlugin[] | undefined
}

export declare const datafluxRum: {
  init: (initConfiguration: RumPluginInitConfiguration) => void
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
    | RumPluginInitConfiguration
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
  startSessionReplayRecording: (
    options?: StartSessionReplayRecordingOptions
  ) => void
  isRecording: () => boolean
  stopSessionReplayRecording: () => void
  takeSubsequentFullSnapshot: () => void
  snapshotCanvas: (
    canvas: HTMLCanvasElement,
    options?: object
  ) => Promise<CanvasSnapshotResult>
  getSerializedNodeIdForDebug: (node: Node) => number | undefined
  getLastAutoCanvasSnapshotResultForDebug: () =>
    | AutoCanvasSnapshotDebugResult
    | undefined
  getAutoCanvasSnapshotDebugHistoryForDebug: () =>
    | AutoCanvasSnapshotDebugResult[]
    | undefined
  getLastCanvasMutationForDebug: () => CanvasMutationDebugResult | undefined
  getCanvasMutationHistoryForDebug: () =>
    | CanvasMutationDebugHistoryResult[]
    | undefined
  getLastDomMutationForDebug: () => DomMutationDebugResult | undefined
  getDomMutationHistoryForDebug: () => DomMutationDebugResult[] | undefined
  getLastReplaySegmentFlushForDebug: () =>
    | ReplaySegmentFlushDebugResult
    | undefined
  getReplaySegmentFlushHistoryForDebug: () =>
    | ReplaySegmentFlushDebugResult[]
    | undefined
  getReplayPerformanceForDebug: () =>
    | ReplayPerformanceDebugResult
    | undefined
  flushReplayMutationsForDebug: () => void
  createResourceTrackerId: () => string
  setResourceContext: (trackerId: string, context: Context) => void
  appendResourceContext: (trackerId: string, context: Context) => void
  finishResource: (trackerId: string) => void
  getResource: (trackerId: string) => ResourceTrackerSnapshot | undefined
} & {
  onReady(callback: () => void): void
}
