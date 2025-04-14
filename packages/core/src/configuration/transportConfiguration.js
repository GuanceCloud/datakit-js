import { isFunction, isBoolean, some } from '../helper/tools'
var TRIM_REGIX = /^\s+|\s+$/g
var typeMap = {
  rum: '/rum',
  log: '/logging',
  sessionReplay: '/rum/replay'
}
function getEndPointUrl(configuration, type) {
  // type: rum, log,replay
  var subUrl = typeMap[type]
  if (!subUrl) return ''
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
    endpoint = trim(url) + 'v1/write' + subUrl
  } else {
    endpoint = trim(url) + '/v1/write' + subUrl
  }
  if (configuration.site && configuration.clientToken) {
    endpoint =
      endpoint + '?token=' + configuration.clientToken + '&to_headless=true'
  }
  return endpoint
}

function trim(str) {
  return str.replace(TRIM_REGIX, '')
}

export function computeTransportConfiguration(initConfiguration) {
  var isIntakeUrl = function (url) {
    return false
  }
  if (
    'isIntakeUrl' in initConfiguration &&
    isFunction(initConfiguration.isIntakeUrl) &&
    isBoolean(initConfiguration.isIntakeUrl())
  ) {
    isIntakeUrl = initConfiguration.isIntakeUrl
  }
  var isServerError = function (request) {
    return false
  }
  if (
    'isServerError' in initConfiguration &&
    isFunction(initConfiguration.isServerError) &&
    isBoolean(initConfiguration.isServerError())
  ) {
    isServerError = initConfiguration.isServerError
  }
  return {
    rumEndpoint: getEndPointUrl(initConfiguration, 'rum'),
    logsEndpoint: getEndPointUrl(initConfiguration, 'log'),
    sessionReplayEndPoint: getEndPointUrl(initConfiguration, 'sessionReplay'),
    isIntakeUrl: isIntakeUrl,
    isServerError: isServerError
  }
}
export function isIntakeRequest(url, configuration) {
  var notTakeRequest = [configuration.rumEndpoint]
  if (configuration.logsEndpoint) {
    notTakeRequest.push(configuration.logsEndpoint)
  }
  if (configuration.sessionReplayEndPoint) {
    notTakeRequest.push(configuration.sessionReplayEndPoint)
  }
  // datakit 地址，log 地址，以及客户自定义过滤方法定义url
  return (
    some(notTakeRequest, function (takeUrl) {
      return url.indexOf(takeUrl) === 0
    }) || configuration.isIntakeUrl(url)
  )
}
