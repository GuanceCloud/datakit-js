import {
  assign,
  ONE_KIBI_BYTE,
  validateAndBuildConfiguration,
  validatePostRequestRequireParamsConfiguration,
  display,
  unique,
  RawReportType,
  isArray,
  every,
  ConsoleApiName,
  includes,
  values
} from '@cloudcare/browser-core'
import { buildEnv } from '../boot/buildEnv'
/**
 * arbitrary value, byte precision not needed
 */
export var DEFAULT_REQUEST_ERROR_RESPONSE_LENGTH_LIMIT = 32 * ONE_KIBI_BYTE

export function validateAndBuildLogsConfiguration(initConfiguration) {
  var requireParamsValidate =
    validatePostRequestRequireParamsConfiguration(initConfiguration)
  if (!requireParamsValidate) return
  var baseConfiguration = validateAndBuildConfiguration(initConfiguration)

  var forwardConsoleLogs = validateAndBuildForwardOption(
    initConfiguration.forwardConsoleLogs,
    values(ConsoleApiName),
    'Forward Console Logs'
  )

  var forwardReports = validateAndBuildForwardOption(
    initConfiguration.forwardReports,
    values(RawReportType),
    'Forward Reports'
  )

  if (!baseConfiguration || !forwardConsoleLogs || !forwardReports) {
    return
  }

  if (
    initConfiguration.forwardErrorsToLogs &&
    !includes(forwardConsoleLogs, ConsoleApiName.error)
  ) {
    forwardConsoleLogs.push(ConsoleApiName.error)
  }
  return assign(
    {
      forwardErrorsToLogs: initConfiguration.forwardErrorsToLogs !== false,
      forwardConsoleLogs: forwardConsoleLogs,
      forwardReports: forwardReports,
      requestErrorResponseLengthLimit:
        DEFAULT_REQUEST_ERROR_RESPONSE_LENGTH_LIMIT
    },
    baseConfiguration,
    buildEnv
  )
}

export function validateAndBuildForwardOption(option, allowedValues, label) {
  if (option === undefined) {
    return []
  }

  if (
    !(
      option === 'all' ||
      (isArray(option) &&
        every(option, function (api) {
          return includes(allowedValues, api)
        }))
    )
  ) {
    display.error(
      label +
        ' should be "all" or an array with allowed values "' +
        allowedValues.join('", "') +
        '"'
    )
    return
  }
  return option === 'all' ? allowedValues : unique(option)
}
