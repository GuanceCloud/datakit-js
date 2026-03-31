import { createEventRateLimiter } from './createEventRateLimiter'
import { ErrorSource } from './errorTools'
import { ONE_MINUTE } from './tools'

describe('createEventRateLimiter', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should allow events until the configured limit is reached', () => {
    const onLimitReached = jasmine.createSpy('onLimitReached')
    const rateLimiter = createEventRateLimiter('error', 2, onLimitReached)

    expect(rateLimiter.isLimitReached()).toBeFalse()
    expect(rateLimiter.isLimitReached()).toBeFalse()
    expect(onLimitReached).not.toHaveBeenCalled()
  })

  it('should notify once when the limit is exceeded and block subsequent events', () => {
    const onLimitReached = jasmine.createSpy('onLimitReached')
    const rateLimiter = createEventRateLimiter('error', 2, onLimitReached)

    rateLimiter.isLimitReached()
    rateLimiter.isLimitReached()

    expect(rateLimiter.isLimitReached()).toBeTrue()
    expect(rateLimiter.isLimitReached()).toBeTrue()

    expect(onLimitReached).toHaveBeenCalledTimes(1)
    expect(onLimitReached.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        message: 'Reached max number of errors by minute: 2',
        source: ErrorSource.AGENT
      })
    )
    expect(onLimitReached.calls.mostRecent().args[0].startClocks).toEqual(
      jasmine.objectContaining({
        relative: jasmine.any(Number),
        timeStamp: jasmine.any(Number)
      })
    )
  })

  it('should reset the limit after one minute', () => {
    const onLimitReached = jasmine.createSpy('onLimitReached')
    const rateLimiter = createEventRateLimiter('error', 1, onLimitReached)

    expect(rateLimiter.isLimitReached()).toBeFalse()
    expect(rateLimiter.isLimitReached()).toBeTrue()

    jasmine.clock().tick(ONE_MINUTE)

    expect(rateLimiter.isLimitReached()).toBeFalse()
    expect(onLimitReached).toHaveBeenCalledTimes(1)
  })
})
