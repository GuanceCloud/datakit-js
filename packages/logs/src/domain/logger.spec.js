import { createCustomerDataTrackerManager, CustomerDataCompressionStatus } from '@cloudcare/browser-core'
import { HandlerType, Logger, StatusType } from './logger'

describe('logs/logger', () => {
  function createTracker() {
    return createCustomerDataTrackerManager(
      CustomerDataCompressionStatus.Unknown
    ).createDetachedTracker()
  }

  it('should forward sanitized log payloads to the handle strategy', () => {
    const handleLogStrategy = jasmine.createSpy('handleLogStrategy')
    const logger = new Logger(
      handleLogStrategy,
      createTracker(),
      'checkout',
      HandlerType.http,
      StatusType.debug,
      { feature: 'cart' }
    )

    logger.log('hello', { nested: { ok: true } }, StatusType.info)

    expect(handleLogStrategy).toHaveBeenCalledWith(
      {
        message: 'hello',
        context: {
          nested: { ok: true }
        },
        status: StatusType.info
      },
      logger,
      jasmine.any(String)
    )
  })

  it('should attach raw error details when logging with an error object', () => {
    const handleLogStrategy = jasmine.createSpy('handleLogStrategy')
    const logger = new Logger(
      handleLogStrategy,
      createTracker(),
      'checkout',
      [HandlerType.http, HandlerType.console],
      StatusType.debug
    )

    logger.error('request failed', { requestId: '1' }, new Error('boom'))

    expect(handleLogStrategy.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        message: 'request failed',
        status: StatusType.error,
        context: jasmine.objectContaining({
          requestId: '1',
          error: jasmine.objectContaining({
            kind: 'Error',
            message: 'boom',
            handling: 'handled'
          })
        })
      })
    )
  })

  it('should manage logger context, handler and level', () => {
    const logger = new Logger(
      jasmine.createSpy('handleLogStrategy'),
      createTracker()
    )

    logger.setContext({ env: 'prod' })
    logger.setContextProperty('feature', 'search')
    logger.removeContextProperty('feature')
    logger.setHandler(HandlerType.silent)
    logger.setLevel(StatusType.error)

    expect(logger.getContext()).toEqual({ env: 'prod' })
    expect(logger.getHandler()).toBe(HandlerType.silent)
    expect(logger.getLevel()).toBe(StatusType.error)

    logger.clearContext()

    expect(logger.getContext()).toEqual({})
  })
})
