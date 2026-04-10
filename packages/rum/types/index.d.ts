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
  status: 'completed' | 'skipped_hidden' | 'skipped_no_candidates'
  timestamp: number
  eligibleCanvasCount: number
  selectedCanvasCount: number
  skippedBudgetCount: number
  keepSessionAliveTriggered: boolean
  results: AutoCanvasSnapshotDebugEntry[]
}

export interface ReplaySegmentFlushDebugResult {
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
  mutationCallbackCount: number
  mutationRecordCount: number
  mutationAddCount: number
  mutationRemoveCount: number
  mutationTextCount: number
  mutationAttributeCount: number
  replaySegmentFlushCount: number
}

export declare const datafluxRum: {
  init: (
    initConfiguration: RumInitConfiguration | RumSiteInitConfiguration
  ) => void
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
    | RumInitConfiguration
    | RumSiteInitConfiguration
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
  setForcedSession: () => void
  startSessionReplayRecording: (options?: { force?: boolean }) => void
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
  getLastReplaySegmentFlushForDebug: () =>
    | ReplaySegmentFlushDebugResult
    | undefined
  getReplaySegmentFlushHistoryForDebug: () =>
    | ReplaySegmentFlushDebugResult[]
    | undefined
  getReplayPerformanceForDebug: () =>
    | ReplayPerformanceDebugResult
    | undefined
} & {
  onReady(callback: () => void): void
}
