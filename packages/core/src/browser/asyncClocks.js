import { addEventListener } from './addEventListener'
import { display } from '../helper/display'
import { trim } from '../configuration/transportConfiguration'
let timeOffset
export function fetchAndApplyRemoteClocks(initConfiguration, callback) {
  const start = performance.now()
  fetchRemoteClocks(initConfiguration, (serverTimestamp) => {
    const end = performance.now()
    const rtt = end - start
    callback(applyRemoteClocks(serverTimestamp, rtt))
  })
}
function applyRemoteClocks(serverTimestamp, rtt) {
  const estimatedClientTime =
    performance.timing.navigationStart + start + rtt / 2

  const offset = serverTimestamp - estimatedClientTime
  return offset
}
export function fetchRemoteClocks(configuration, callback) {
  const xhr = new XMLHttpRequest()

  addEventListener(xhr, 'load', function () {
    if (xhr.status === 200) {
      const remoteConfiguration = JSON.parse(xhr.responseText)
      callback(remoteConfiguration.content)
    } else {
      displayRemoteClocksFetchingError()
    }
  })

  addEventListener(xhr, 'error', function () {
    callback({})
    displayRemoteClocksFetchingError()
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
    url = location.origin + trim(url)
  }
  var endpoint = url
  if (url.lastIndexOf('/') === url.length - 1) {
    endpoint = trim(url) + 'v1/env_variable'
  } else {
    endpoint = trim(url) + '/v1/env_variable'
  }
  endpoint += '?app_id=' + configuration.applicationId
  //testing-openway.dataflux.cn/v1/env_variable?token=a47fb0cdddaa4561a90d941317cdbc0b&app_id=d1b454d0_22eb_11ef_9b66_95ca11aa2c6c&to_headless=true
  if (configuration.site && configuration.clientToken) {
    endpoint =
      endpoint + '&token=' + configuration.clientToken + '&to_headless=true'
  }
  return endpoint
}

function displayRemoteClocksFetchingError() {
  display.error('Error fetching the remote configuration.')
}
