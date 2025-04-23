import { addEventListener } from '../browser/addEventListener'
import { display } from '../helper/display'
import { trim } from './transportConfiguration'
import { objectEntries, getType } from '../helper/tools'
export function fetchAndApplyRemoteConfiguration(initConfiguration, callback) {
  fetchRemoteConfiguration(initConfiguration, (remoteInitConfiguration) => {
    callback(
      applyRemoteConfiguration(initConfiguration, remoteInitConfiguration)
    )
  })
}
/**
 * 数据上报采样率，100 表示全收集；0 表示不收集。默认 100
 */
//   sessionSampleRate?: number | undefined
//   telemetrySampleRate?: number | undefined
//   silentMultipleInit?: boolean | undefined

//   service?: string | undefined
//   /** Web 应用当前环境，如 prod：线上环境；gray：灰度环境；pre：预发布环境；common：日常环境；local：本地环境。 */
//   env?: string | undefined
//   /** Web 应用的版本号。 */
//   version?: string | undefined
//   /** 链路数据采样百分比：100 表示全收集；0 表示不收集。 */
//   tracingSampleRate?: number | undefined
//   /**
//    * @deprecated use usePartitionedCrossSiteSessionCookie instead
//    */
//   useCrossSiteSessionCookie?: boolean | undefined
//   /**
//    * 是否使用跨域 cookie，开启第三方 cookie 跨分区实现。默认不允许跨域，例如嵌套跨域 iframe 的情况。
//    */
//   usePartitionedCrossSiteSessionCookie?: boolean | undefined
//   useSecureSessionCookie?: boolean | undefined
//   trackSessionAcrossSubdomains?: boolean | undefined
//   /**
//    * 是否把公共数据存储到localstorage,默认不存储
//    */
//   storeContextsToLocal?: boolean | undefined
//   /**
//    * 定义存储到 localstorage 的 key ，默认不填，自动生成, 该参数主要是为了区分在同一个域名下，不同子路径共用store 的问题
//    */
//   storeContextsKey?: string | undefined
//   /**
//    * 数据以 application/json 的发送方式，默认text
//    */
//   sendContentTypeByJson?: boolean | undefined
//   /**
//    * 在 cookie 不可用的情况下，可以开启该选项，把数据储存到 localstorage
//    */
// allowFallbackToLocalStorage ?: boolean | undefined
//   /**
//    * 错误会话补偿采样率：
//    * - 当会话未被 `sessionSampleRate` 采样时，若会话期间发生错误，则按此比例采集
//    * 此类会话将在错误发生时开始记录事件，并持续记录直到会话结束。
//    * - 取值范围 0-100，100 表示全采错误会话，0 表示忽略错误会话
//    */
//   sessionOnErrorSampleRate?: number | undefined

//   /**
//    * Session Replay 全量采集采样率：
//    * - 用于控制所有会话重放的全量数据采集比例
//    * - 取值范围 0-100，100 表示全量采集，0 表示不采集
//    **/
//   sessionReplaySampleRate?: number | undefined

//   /** 错误会话重放补偿采样率：
//    * - 当会话未被 `sessionReplaySampleRate` 采样时，若会话期间发生错误，则按此比例采集
//    * 此类回放将记录错误发生前最多一分钟的事件，并持续记录直到会话结束。
// 100 表示全收集；0 表示不收集。
//      */
//   sessionReplayOnErrorSampleRate?: number | undefined
//   /**
//    * 是否开启用户行为采集。
//    */
//   trackUserInteractions?: boolean | undefined
//   /**
//    * 指定 action 数据 name 获取方式，默认自动获取，可以指定元素特定属性名称,alt,name,title,aria-labelledby,aria-label,data-guance-action-name 这些属性
//    */
//   actionNameAttribute?: string | undefined
//   trackViewsManually?: boolean | undefined
//   /**
//    * sessionReplay 和 compressIntakeRequests数据压缩都是在 webwork 线程中完成，所以默认情况下，需要在开启csp 安全访问的情况下，允许 worker-src blob:; workerUrl 配置允许自行托管 worker 地址
//    */
//   workerUrl?: string
//   /**
//    * 压缩 RUM 数据请求内容，以减少发送大量数据时的带宽使用量。压缩在 Worker 线程中完成。
//    */
// compressIntakeRequests ?: boolean | undefined
//    /**
//      * 配置链路追踪工具类型，如果不配置默认为 ddtrace。目前支持 ddtrace、zipkin、skywalking_v3、jaeger、zipkin_single_header、w3c_traceparent 6 种数据类型。
//      */
//     traceType?: TraceType

const modifiableFieldPaths = {
  sessionSampleRate: 'number',
  telemetrySampleRate: 'number',
  silentMultipleInit: 'boolean',
  service: 'string',
  env: 'string',
  version: 'string',
  tracingSampleRate: 'number',
  useCrossSiteSessionCookie: 'boolean',
  usePartitionedCrossSiteSessionCookie: 'boolean',
  useSecureSessionCookie: 'boolean',
  trackSessionAcrossSubdomains: 'boolean',
  storeContextsToLocal: 'boolean',
  storeContextsKey: 'string',
  sendContentTypeByJson: 'boolean',
  allowFallbackToLocalStorage: 'boolean',
  sessionOnErrorSampleRate: 'number',
  sessionReplaySampleRate: 'number',
  sessionReplayOnErrorSampleRate: 'number',
  trackUserInteractions: 'boolean',
  trackInteractions: 'boolean',
  actionNameAttribute: 'string',
  trackViewsManually: 'boolean',
  workerUrl: 'string',
  compressIntakeRequests: 'boolean',
  traceType: 'string'
}
function modificationByFieldsPath(remoteConfiguration, modifiableFieldPaths) {
  const result = {}
  objectEntries(modifiableFieldPaths).forEach(([fieldPath, fieldType]) => {
    // const sourceValue = sourceConfiguration[fieldPath]
    const remoteValue = remoteConfiguration[fieldPath]
    if (getType(remoteValue) === fieldType) {
      result[fieldPath] = remoteValue
    }
  })
  return result
}
export function applyRemoteConfiguration(
  initConfiguration,
  remoteInitConfiguration
) {
  const simpleRemoteInitConfiguration = {}
  for (const key in remoteInitConfiguration) {
    if (remoteInitConfiguration[key] !== undefined) {
      //  ex
      //        {
      //     "R.d1b454d0_22eb_11ef_9b66_95ca11aa2c6c.sessionSampleRate": 80
      // }
      //  transform to
      // {
      //     "sessionSampleRate": 80
      // }
      const simpleKey = key.replace(
        'R.' + initConfiguration.applicationId + '.',
        ''
      )
      simpleRemoteInitConfiguration[simpleKey] = remoteInitConfiguration[key]
    }
  }
  return {
    ...initConfiguration,
    ...modificationByFieldsPath(
      simpleRemoteInitConfiguration,
      modifiableFieldPaths
    )
  }
}

export function fetchRemoteConfiguration(configuration, callback) {
  const xhr = new XMLHttpRequest()

  addEventListener(xhr, 'load', function () {
    if (xhr.status === 200) {
      const remoteConfiguration = JSON.parse(xhr.responseText)
      callback(remoteConfiguration.content)
    } else {
      callback({})
      displayRemoteConfigurationFetchingError()
    }
  })

  addEventListener(xhr, 'error', function () {
    callback({})
    displayRemoteConfigurationFetchingError()
  })

  xhr.open('GET', buildEndpoint(configuration))
  xhr.send()
}

export function buildEndpoint(configuration) {
  var url =
    configuration.datakitOrigin ||
    configuration.datakitUrl ||
    configuration.site
  if (url.indexOf('/') === 0) {
    // 绝对路径这种 /xxx
    url = location.origin + trim(url)
  }
  var endpoint = url
  if (url.lastIndexOf('/') === url.length - 1) {
    endpoint = trim(url) + 'v1/env_variable'
  } else {
    endpoint = trim(url) + '/v1/env_variable'
  }
  // 这里需要加上token和app_id
  endpoint += '?app_id=' + configuration.applicationId
  //testing-openway.dataflux.cn/v1/env_variable?token=a47fb0cdddaa4561a90d941317cdbc0b&app_id=d1b454d0_22eb_11ef_9b66_95ca11aa2c6c&to_headless=true
  if (configuration.site && configuration.clientToken) {
    endpoint =
      endpoint + '&token=' + configuration.clientToken + '&to_headless=true'
  }
  return endpoint
}

function displayRemoteConfigurationFetchingError() {
  display.error('Error fetching the remote configuration.')
}
