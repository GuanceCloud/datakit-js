import { noop } from './tools'
export var ConsoleApiName = {
  log: 'log',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
}
export var globalConsole = console

export var originalConsoleMethods = {}
Object.keys(ConsoleApiName).forEach(function (name) {
  originalConsoleMethods[name] = globalConsole[name] || noop
})

var PREFIX = 'GUANCE Browser SDK:'

export var display = {
  debug: originalConsoleMethods.debug.bind(globalConsole, PREFIX),
  log: originalConsoleMethods.log.bind(globalConsole, PREFIX),
  info: originalConsoleMethods.info.bind(globalConsole, PREFIX),
  warn: originalConsoleMethods.warn.bind(globalConsole, PREFIX),
  error: originalConsoleMethods.error.bind(globalConsole, PREFIX)
}
