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

function displayRemoteConfigurationFetchingError() {
  display.error('Error fetching the remote configuration.')
}
