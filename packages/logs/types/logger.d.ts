import type { Context } from '@cloudcare/browser-core'
export interface LogsMessage {
  message: string
  status: StatusType
  context?: Context
}
export declare const StatusType: {
  readonly debug: 'debug'
  readonly error: 'error'
  readonly info: 'info'
  readonly warn: 'warn'
}
export type StatusType = (typeof StatusType)[keyof typeof StatusType]
export declare const HandlerType: {
  readonly console: 'console'
  readonly http: 'http'
  readonly silent: 'silent'
}
export type HandlerType = (typeof HandlerType)[keyof typeof HandlerType]
export declare const STATUSES: StatusType[]
export declare class Logger {
  private handleLogStrategy
  private handlerType
  private level
  private contextManager
  constructor(
    handleLogStrategy: (logsMessage: LogsMessage, logger: Logger) => void,
    name?: string,
    handlerType?: HandlerType | HandlerType[],
    level?: StatusType,
    loggerContext?: object
  )
  log(
    message: string,
    messageContext?: object,
    status?: StatusType,
    error?: Error
  ): void
  debug(message: string, messageContext?: object, error?: Error): void
  info(message: string, messageContext?: object, error?: Error): void
  warn(message: string, messageContext?: object, error?: Error): void
  error(message: string, messageContext?: object, error?: Error): void
  setContext(context: object): void
  getContext(): Context
  setContextProperty(key: string, value: any): void
  removeContextProperty(key: string): void
  clearContext(): void
  setHandler(handler: HandlerType | HandlerType[]): void
  getHandler(): HandlerType | HandlerType[]
  setLevel(level: StatusType): void
  getLevel(): StatusType
}
