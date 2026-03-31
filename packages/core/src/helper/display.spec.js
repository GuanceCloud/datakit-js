import {
  ConsoleApiName,
  display,
  globalConsole,
  originalConsoleMethods
} from './display'

describe('display', () => {
  it('should expose console api names and original methods', () => {
    expect(ConsoleApiName).toEqual({
      log: 'log',
      debug: 'debug',
      info: 'info',
      warn: 'warn',
      error: 'error'
    })
    expect(originalConsoleMethods.log).toEqual(jasmine.any(Function))
    expect(originalConsoleMethods.error).toEqual(jasmine.any(Function))
    expect(globalConsole.log).toEqual(jasmine.any(Function))
    expect(globalConsole.error).toEqual(jasmine.any(Function))
  })

  it('should prefix console output helpers', () => {
    expect(display.log).toEqual(jasmine.any(Function))
    expect(display.warn).toEqual(jasmine.any(Function))
    expect(display.error).toEqual(jasmine.any(Function))

    expect(() => {
      display.log('message', { value: 1 })
      display.warn('warning')
      display.error('error')
    }).not.toThrow()
  })
})
