export interface Context {
  [x: string]: ContextValue
}
export interface User {
  id?: string | undefined
  email?: string | undefined
  name?: string | undefined
  [key: string]: unknown
}
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
   *  以openway 方式上报数据令牌，从观测云控制台获取，必填
   */
  clientToken: string | undefined

  /**
   *  以 公共openway 方式上报数据地址，从观测云控制台获取，必填
   */
  site: string | undefined
}
export interface DatakitInitConfiguration {
  /** DataKit 数据上报 Origin 注释:
   * 协议（包括：//），域名（或IP地址）[和端口号]
   * 例如：
   * https://www.datakit.com；
   * http://100.20.34.3:8088。
   */
  datakitOrigin: string
}
export interface InitConfiguration {
  /**
   *  数据发送前的的拦截器
   * @param event  事件内容
   * @param context  事件额外属性
   * @returns
   */
  beforeSend?: (event: any, context?: any) => unknown | undefined
  /**
   * 数据上报采样率，100 表示全收集；0 表示不收集。默认 100
   */
  sessionSampleRate?: number | undefined
  telemetrySampleRate?: number | undefined
  silentMultipleInit?: boolean | undefined

  service?: string | undefined
  /** Web 应用当前环境，如 prod：线上环境；gray：灰度环境；pre：预发布环境；common：日常环境；local：本地环境。 */
  env?: string | undefined
  /** Web 应用的版本号。 */
  version?: string | undefined
  /** 链路数据采样百分比：100 表示全收集；0 表示不收集。 */
  tracingSampleRate?: number | undefined
  /**
   * @deprecated use usePartitionedCrossSiteSessionCookie instead
   */
  useCrossSiteSessionCookie?: boolean | undefined
  /**
   * 是否使用跨域 cookie，开启第三方 cookie 跨分区实现。默认不允许跨域，例如嵌套跨域 iframe 的情况。
   */
  usePartitionedCrossSiteSessionCookie?: boolean | undefined
  useSecureSessionCookie?: boolean | undefined
  trackSessionAcrossSubdomains?: boolean | undefined
  /**
   * 是否把公共数据存储到localstorage,默认不存储
   */
  storeContextsToLocal?: boolean | undefined
  /**
   * 定义存储到 localstorage 的 key ，默认不填，自动生成, 该参数主要是为了区分在同一个域名下，不同子路径共用store 的问题
   */
  storeContextsKey?: string | undefined
  /**
   * 数据以 application/json 的发送方式，默认text
   */
  sendContentTypeByJson?: boolean | undefined
  /**
   * 在 cookie 不可用的情况下，可以开启该选项，把数据储存到 localstorage
   */
  allowFallbackToLocalStorage?: boolean | undefined
}
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
  /**从观测云创建的应用 ID */
  applicationId: string
  /**
   * 排除一些影响 loadingtime 的指标准确性的url，具体可参考下面文档
   * https://docs.guance.com/security/page-performance/#_3
   */
  excludedActivityUrls?: MatchOption[] | undefined
  /**
     * 允许注入 trace 采集器所需 header 头部的所有请求列表。可以是请求的 origin，也可以是正则，origin: 协议（包括：//），域名（或IP地址）[和端口号]。例如：
     ["https://api.example.com", /https:\\/\\/.*\\.my-api-domain\\.com/]。
    */
  allowedTracingUrls?: Array<MatchOption | TracingOption> | undefined
  defaultPrivacyLevel?: DefaultPrivacyLevel | undefined
  /**
   * 错误会话补偿采样率：
   * - 当会话未被 `sessionSampleRate` 采样时，若会话期间发生错误，则按此比例采集
   * 此类会话将在错误发生时开始记录事件，并持续记录直到会话结束。
   * - 取值范围 0-100，100 表示全采错误会话，0 表示忽略错误会话
   */
  sessionOnErrorSampleRate?: number | undefined

  /**
   * Session Replay 全量采集采样率：
   * - 用于控制所有会话重放的全量数据采集比例
   * - 取值范围 0-100，100 表示全量采集，0 表示不采集
   **/
  sessionReplaySampleRate?: number | undefined

  /** 错误会话重放补偿采样率：
   * - 当会话未被 `sessionReplaySampleRate` 采样时，若会话期间发生错误，则按此比例采集
   * 此类回放将记录错误发生前最多一分钟的事件，并持续记录直到会话结束。
100 表示全收集；0 表示不收集。
     */
  sessionReplayOnErrorSampleRate?: number | undefined
  /**
   * 是否开启用户行为采集。
   */
  trackUserInteractions?: boolean | undefined
  /**
   * 指定 action 数据 name 获取方式，默认自动获取，可以指定元素特定属性名称,alt,name,title,aria-labelledby,aria-label,data-guance-action-name 这些属性
   */
  actionNameAttribute?: string | undefined
  trackViewsManually?: boolean | undefined
  /**
   * sessionReplay 和 compressIntakeRequests数据压缩都是在 webwork 线程中完成，所以默认情况下，需要在开启csp 安全访问的情况下，允许 worker-src blob:; workerUrl 配置允许自行托管 worker 地址
   */
  workerUrl?: string
  /**
   * 压缩 RUM 数据请求内容，以减少发送大量数据时的带宽使用量。压缩在 Worker 线程中完成。
   */
  compressIntakeRequests?: boolean | undefined
  /**
   * 是否开启数据采集的远程配置功能，默认不开启
   * 远程配置功能可以在不发布新版本的情况下，动态修改数据采集的配置项
   * 例如：可以在远程配置中修改采样率、是否开启用户行为采集等
   * 远程配置功能需要在观测云控制台中开启
   *
   */
  remoteConfiguration?: boolean | undefined
  /**
   * 配置链路追踪工具类型，如果不配置默认为 ddtrace。目前支持 ddtrace、zipkin、skywalking_v3、jaeger、zipkin_single_header、w3c_traceparent 6 种数据类型。
   */
  traceType?: TraceType
  /**
   * 是否以 128 字节的方式生成 traceID，与 traceType 对应，目前支持类型 zipkin、jaeger。
   */
  traceId128Bit?: boolean | undefined
  /**
   * Fetch/Xhr 拦截之后，往请求 header 添加额外 header-key，受 allowedTracingUrls 影响
   * @param context  请求附带额外信息，包括traceid spanid url 等内容
   * @returns 返回 key: value 对象, 请求添加的额外 key
   */
  injectTraceHeader?: (content: any) => { [key: string]: string } | undefined
  /**
   * traceId 生成器，覆盖 SDK 内部traceId 实现,默认不配置。
   * @returns 返回对应 traceType 类型的traceId。
   */
  generateTraceId?: () => string
  /**
   * 是否开启 longAnimationFrame 采集，覆盖 longtask 采集，目前调试阶段
   */
  enableLongAnimationFrame?: boolean | undefined
  /**
   * session replay 是否屏蔽某个节点数据，可用于实现对某些特定 node 屏蔽效果
   * @param node 节点对象
   * @param privacyLevel 当前隐私等级
   * @returns true 表示屏蔽该节点，false 表示不屏蔽节点 继续执行 privacyLevel 逻辑
   */
  shouldMaskNode?: (node: Node, privacyLevel: NodePrivacyLevel) => boolean
}
export type RumInitConfiguration = RumBaseInitConfiguration &
  DatakitInitConfiguration
export type RumSiteInitConfiguration = RumBaseInitConfiguration &
  SiteInitConfiguration
