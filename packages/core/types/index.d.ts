export interface Context {
  [x: string]: ContextValue
}
export interface User {
  id?: string | undefined
  email?: string | undefined
  name?: string | undefined
  [key: string]: unknown
}
export type SessionPersistence = 'cookie' | 'local-storage'

export declare const ConsoleApiName: {
  readonly log: 'log'
  readonly debug: 'debug'
  readonly info: 'info'
  readonly warn: 'warn'
  readonly error: 'error'
}
export type ConsoleApiName = typeof ConsoleApiName

export declare const RawReportType: {
  readonly intervention: 'intervention'
  readonly deprecation: 'deprecation'
  readonly cspViolation: 'csp_violation'
}
export type RawReportType = (typeof RawReportType)[keyof typeof RawReportType]

export interface SiteInitConfiguration {
  /**
   *  Data reporting token in openway mode, obtained from the TrueWatch Cloud console. Required.
   */
  clientToken: string | undefined

  /**
   *  Data reporting address in public openway mode, obtained from the TrueWatch Cloud console. Required.
   */
  site: string | undefined
}
export interface DatakitInitConfiguration {
  /** DataKit data reporting Origin:
   * Protocol (including ://), domain name (or IP address) [and port number]
   * For example:
   * https://www.datakit.com;
   * http://100.20.34.3:8088.
   */
  datakitOrigin: string
}
export interface InitConfiguration {
  /**
   *  Interceptor before sending data
   * @param event  Event content
   * @param context  Additional event properties
   * @returns
   */
  beforeSend?: (event: any, context?: any) => unknown | undefined
  /**
   * Data reporting sample rate, 100 means collect all; 0 means do not collect. Default is 100
   */
  sessionSampleRate?: number | undefined
  telemetrySampleRate?: number | undefined
  silentMultipleInit?: boolean | undefined

  service?: string | undefined
  /** Current environment of the web application, such as prod: production; gray: gray environment; pre: pre-release; common: daily; local: local environment. */
  env?: string | undefined
  /** Version number of the web application. */
  version?: string | undefined
  /** Trace data sampling percentage: 100 means collect all; 0 means do not collect. */
  tracingSampleRate?: number | undefined
  /**
   * @deprecated use usePartitionedCrossSiteSessionCookie instead
   */
  useCrossSiteSessionCookie?: boolean | undefined
  /**
   * Whether to use cross-site cookies, enabling third-party cookie partitioning. By default, cross-site is not allowed, such as nested cross-domain iframes.
   */
  usePartitionedCrossSiteSessionCookie?: boolean | undefined
  useSecureSessionCookie?: boolean | undefined
  trackSessionAcrossSubdomains?: boolean | undefined
  /**
   * Whether to store public data in localStorage, default is not to store
   */
  storeContextsToLocal?: boolean | undefined
  /**
   * Define the key for storing in localStorage. If not filled, it is automatically generated. This parameter is mainly to distinguish the problem of sharing store under different subpaths of the same domain.
   */
  storeContextsKey?: string | undefined
  /**
   * Send data as application/json, default is text
   */
  sendContentTypeByJson?: boolean | undefined
  /**
   * When cookies are not available, you can enable this option to store data in localStorage
   */
  allowFallbackToLocalStorage?: boolean | undefined
  /**
   * Which storage strategy to use for persisting sessions. Can be either 'cookie' or 'local-storage'.
   *
   * Important: If you are using the RUM and Logs Browser SDKs, this option must be configured with identical values
   * @default "cookie"
   */
  sessionPersistence?: SessionPersistence | undefined
  /**
   * Enables opt-in experimental SDK capabilities.
   * Use `track_websockets` to collect connection-level WebSocket resource metrics.
   */
  enableExperimentalFeatures?: string[] | undefined
}
export declare const ExperimentalFeature: {
  readonly TRACK_WEBSOCKETS: 'track_websockets'
}
export type ExperimentalFeature =
  (typeof ExperimentalFeature)[keyof typeof ExperimentalFeature]
export declare const ResourceType: {
  readonly DOCUMENT: 'document'
  readonly XHR: 'xhr'
  readonly BEACON: 'beacon'
  readonly FETCH: 'fetch'
  readonly CSS: 'css'
  readonly JS: 'js'
  readonly IMAGE: 'image'
  readonly FONT: 'font'
  readonly MEDIA: 'media'
  readonly WEBSOCKET: 'websocket'
  readonly OTHER: 'other'
  readonly CUSTOM: 'custom'
}
export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType]
export enum TraceType {
  DDTRACE = 'ddtrace',
  ZIPKIN_MULTI_HEADER = 'zipkin',
  ZIPKIN_SINGLE_HEADER = 'zipkin_single_header',
  W3C_TRACEPARENT = 'w3c_traceparent',
  W3C_TRACEPARENT_64 = 'w3c_traceparent_64bit',
  SKYWALKING_V3 = 'skywalking_v3',
  JAEGER = 'jaeger'
}
export declare const DefaultPrivacyLevel: {
  readonly ALLOW: 'allow'
  readonly MASK: 'mask'
  readonly MASK_USER_INPUT: 'mask-user-input'
}
export type DefaultPrivacyLevel =
  (typeof DefaultPrivacyLevel)[keyof typeof DefaultPrivacyLevel]

export const NodePrivacyLevel = {
  IGNORE: 'ignore',
  HIDDEN: 'hidden',
  ALLOW: DefaultPrivacyLevel.ALLOW,
  MASK: DefaultPrivacyLevel.MASK,
  MASK_USER_INPUT: DefaultPrivacyLevel.MASK_USER_INPUT
} as const
export type NodePrivacyLevel =
  (typeof NodePrivacyLevel)[keyof typeof NodePrivacyLevel]
export type OriginMatchOption = string | RegExp
export type MatchOption = string | RegExp | ((value: string) => boolean)
export type TracingOption = {
  match: MatchOption
  traceType: TraceType
}

export declare function isMatchOption(item: unknown): item is MatchOption
/**
 * Returns true if value can be matched by at least one of the provided MatchOptions.
 * When comparing strings, setting useStartsWith to true will compare the value with the start of
 * the option, instead of requiring an exact match.
 */
export declare function matchList(
  list: MatchOption[],
  value: string,
  useStartsWith?: boolean
): boolean

export interface RumBaseInitConfiguration extends InitConfiguration {
  /** Application ID created from TrueWatch Cloud */
  applicationId: string
  /**
   * Exclude some URLs that affect the accuracy of loadingtime indicators. See the following documentation for details:
   * https://docs.truewatch.com/security/page-performance/#_3
   */
  excludedActivityUrls?: MatchOption[] | undefined
  /**
       * List of all requests allowed to inject trace collector required headers. For example:
       ["https://api.example.com/test", /https:\\/\\/.*\\.my-api-domain\\.com/, (url) => { return true }].
      */
  allowedTracingUrls?: Array<MatchOption | TracingOption> | undefined
  /**
       * List of all requests allowed to inject trace collector required headers. Can be the request origin or a regex. Origin: protocol (including ://), domain name (or IP address) [and port number]. For example:
       ["https://api.example.com", /https:\\/\\/.*\\.my-api-domain\\.com/].
      */
  allowedTracingOrigins?: Array<OriginMatchOption> | undefined
  defaultPrivacyLevel?: DefaultPrivacyLevel | undefined
  /**
   * Error session compensation sample rate:
   * - When the session is not sampled by `sessionSampleRate`, if an error occurs during the session, it will be collected according to this ratio.
   * Such sessions will start recording events when an error occurs and continue until the session ends.
   * - Value range 0-100, 100 means collect all error sessions, 0 means ignore error sessions
   */
  sessionOnErrorSampleRate?: number | undefined

  /**
   * Session Replay full collection sample rate:
   * - Used to control the proportion of full data collection for all session replays
   * - Value range 0-100, 100 means full collection, 0 means no collection
   **/
  sessionReplaySampleRate?: number | undefined

  /** Error session replay compensation sample rate:
   * - When the session is not sampled by `sessionReplaySampleRate`, if an error occurs during the session, it will be collected according to this ratio.
   * Such replays will record up to one minute of events before the error occurs and continue recording until the session ends.
   * 100 means collect all; 0 means do not collect.
   */
  sessionReplayOnErrorSampleRate?: number | undefined
  /**
   * Whether to enable user interaction collection.
   */
  trackUserInteractions?: boolean | undefined
  /**
   * Specify how to get the action data name. By default, it is obtained automatically. You can specify the element's specific attribute name, such as alt, name, title, aria-labelledby, aria-label, data-truewatch-action-name, etc.
   */
  actionNameAttribute?: string | undefined
  trackViewsManually?: boolean | undefined
  /**
   * sessionReplay and compressIntakeRequests data compression are both done in the web worker thread, so by default, you need to allow worker-src blob: under CSP security access, or use workerUrl to host the worker address yourself
   */
  workerUrl?: string
  /**
   * Canvas snapshot encoding is done in a dedicated canvas worker thread. By
   * default it uses an inlined blob worker, or you can host a separate
   * canvas-worker bundle yourself for stricter CSP/security environments.
   */
  replayCanvasWorkerUrl?: string
  /**
   * Compress RUM data request content to reduce bandwidth usage when sending large amounts of data. Compression is done in the Worker thread.
   */
  compressIntakeRequests?: boolean | undefined
  /**
   * Whether to enable remote configuration for data collection. Disabled by default.
   * The remote configuration feature allows you to dynamically modify data collection configuration items without releasing a new version.
   * For example: you can modify the sampling rate, whether to enable user interaction collection, etc. in the remote configuration.
   * The remote configuration feature needs to be enabled in the TrueWatch Cloud console.
   *
   */
  remoteConfiguration?: boolean | undefined
  /**
   * Configure the type of trace tool. If not configured, ddtrace is used by default. Currently supports 6 types: ddtrace, zipkin, skywalking_v3, jaeger, zipkin_single_header, w3c_traceparent.
   */
  traceType?: TraceType
  /**
   * Whether to generate traceID in 128-bit mode, corresponding to traceType. Currently supported types: zipkin, jaeger.
   */
  traceId128Bit?: boolean | undefined
  /**
   * After Fetch/Xhr interception, add extra header-keys to the request header, affected by allowedTracingUrls
   * @param context  Additional information attached to the request, including traceid, spanid, url, etc.
   * @returns Returns a key: value object, the extra keys to be added to the request
   */
  injectTraceHeader?: (content: any) => { [key: string]: string } | undefined
  /**
   * traceId generator, overrides the SDK's internal traceId implementation. Default is not configured.
   * @returns Returns the traceId corresponding to the traceType type.
   */
  generateTraceId?: () => string
  /**
   * Whether to enable longAnimationFrame collection, overriding longtask collection. Currently in debugging stage.
   */
  enableLongAnimationFrame?: boolean | undefined
  /**
   * Whether to mask a node's data in session replay, can be used to implement masking for specific nodes
   * @param node Node object
   * @param privacyLevel Current privacy level
   * @returns true means mask the node, false means do not mask and continue privacyLevel logic
   */
  shouldMaskNode?: (node: Node, privacyLevel: NodePrivacyLevel) => boolean
  /**
   * Whether to enable canvas recording for session replay.
   */
  replayCanvasEnabled?: boolean | undefined
  /**
   * Canvas replay recording mode. Defaults to `auto`.
   * `manual` records only when `snapshotCanvas()` is called.
   * `auto` performs automatic canvas recording.
   */
  replayCanvasMode?: 'manual' | 'auto' | undefined
  /**
   * Canvas replay sampling strategy. A number means snapshot sampling at the configured rate.
   * `'all'` enables 2D command capture, with automatic snapshot fallback for
   * unsupported replay-fidelity cases. Defaults to a numeric sampling mode.
   */
  replayCanvasSampling?: 'all' | number | undefined
  /**
   * Encoded image mime type used for canvas snapshots.
   */
  replayCanvasMimeType?: string | undefined
  /**
   * Encoded image quality for canvas snapshots. Supports `low`, `medium`, `high`,
   * or a number from 0 to 1 for advanced overrides.
   */
  replayCanvasQuality?: 'low' | 'medium' | 'high' | number | undefined
  /**
   * Maximum canvas edge size before downscaling for encoding.
   */
  replayCanvasMaxCanvasSize?: number | undefined
  /**
   * Maximum encoded bytes allowed for a single canvas snapshot.
   */
  replayCanvasMaxEncodedBytes?: number | undefined
  /**
   * Maximum number of concurrent canvas encoding tasks.
   */
  replayCanvasMaxConcurrentEncodes?: number | undefined
  /**
   * Whether canvas mutations should be flushed into a replay segment immediately.
   */
  replayCanvasFlushImmediately?: boolean | undefined
  /**
   * Auto snapshot interval in milliseconds when `replayCanvasMode` is `auto`.
   */
  replayCanvasAutoInterval?: number | undefined
  /**
   * Minimum cooldown in milliseconds after a successful auto snapshot.
   */
  replayCanvasAutoCooldown?: number | undefined
  /**
   * Backoff in milliseconds after an auto snapshot is skipped as unchanged.
   */
  replayCanvasAutoUnchangedBackoff?: number | undefined
  /**
   * Backoff in milliseconds after an auto snapshot fails.
   */
  replayCanvasAutoFailureBackoff?: number | undefined
  /**
   * Maximum number of canvases processed in a single auto snapshot run.
   */
  replayCanvasAutoMaxPerRun?: number | undefined
  /**
   * Controls whether a canvas should be recorded. Returning `false` skips the canvas.
   * Returning a number assigns auto mode priority, where higher values are processed first.
   */
  shouldRecordCanvas?:
    | ((canvas: HTMLCanvasElement) => boolean | number | undefined)
    | undefined
}
export type RumInitConfiguration = RumBaseInitConfiguration &
  DatakitInitConfiguration
export type RumSiteInitConfiguration = RumBaseInitConfiguration &
  SiteInitConfiguration
