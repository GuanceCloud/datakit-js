import { defineGlobal, getGlobalObject } from '@cloudcare/browser-core'
import { makeLogsPublicApi } from '../boot/logsPublicApi'
import { startLogs } from '../boot/startLogs'

export const datafluxLogs = makeLogsPublicApi(startLogs)

defineGlobal(getGlobalObject(), 'DATAFLUX_LOGS', datafluxLogs)
