import type { Logger, LoggerConfiguration } from './logger'
import type {
  LogsInitConfiguration,
  LogsSiteConfiguration
} from './configuration'
import type { User, Context } from '@cloudcare/browser-core'
export interface InternalContext {
  session: {
    id: string | undefined
  }
}
export declare const datafluxLogs: {
  logger: Logger
  init: (
    initConfiguration: LogsInitConfiguration | LogsSiteConfiguration
  ) => void
  getGlobalContext: () => Context
  setGlobalContext: (context: any) => void
  setGlobalContextProperty: (key: any, value: any) => void
  removeGlobalContextProperty: (key: any) => void
  clearGlobalContext: () => void
  createLogger: (name: string, conf?: LoggerConfiguration) => Logger
  getLogger: (name: string) => Logger | undefined
  getInitConfiguration: () =>
    | LogsInitConfiguration
    | LogsSiteConfiguration
    | undefined
  getInternalContext: (
    startTime?: number | undefined
  ) => InternalContext | undefined
  setUser: (newUser: User) => void
  getUser: () => Context
  setUserProperty: (key: any, property: any) => void
  removeUserProperty: (key: any) => void
  clearUser: () => void
} & {
  onReady(callback: () => void): void
}
