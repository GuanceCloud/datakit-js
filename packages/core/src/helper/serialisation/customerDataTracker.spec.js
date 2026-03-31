import { display } from '../display'
import {
  BYTES_COMPUTATION_THROTTLING_DELAY,
  createCustomerDataTracker,
  createCustomerDataTrackerManager
} from './customerDataTracker'

describe('customerDataTracker', () => {
  beforeEach(() => {
    jasmine.clock().install()
  })

  afterEach(() => {
    jasmine.clock().uninstall()
  })

  it('should compute bytes count after the throttling delay', () => {
    const tracker = createCustomerDataTracker(jasmine.createSpy('checkLimit'))

    tracker.updateCustomerData({ value: 'abc' })

    const initialBytesCount = tracker.getBytesCount()
    expect(initialBytesCount).toBeGreaterThan(0)

    jasmine.clock().tick(BYTES_COMPUTATION_THROTTLING_DELAY)

    expect(tracker.getBytesCount()).toBe(initialBytesCount)
  })

  it('should reset bytes count when the context is empty', () => {
    const tracker = createCustomerDataTracker(jasmine.createSpy('checkLimit'))

    tracker.updateCustomerData({ value: 'abc' })
    jasmine.clock().tick(BYTES_COMPUTATION_THROTTLING_DELAY)
    tracker.updateCustomerData({})

    expect(tracker.getBytesCount()).toBe(0)
  })

  it('should reuse manager trackers for the same type', () => {
    const manager = createCustomerDataTrackerManager()

    expect(manager.getOrCreateTracker('user')).toBe(
      manager.getOrCreateTracker('user')
    )

    manager.stop()
  })

  it('should warn when tracked customer data exceeds the recommended limit', () => {
    const manager = createCustomerDataTrackerManager()
    const tracker = manager.getOrCreateTracker('user')
    spyOn(display, 'warn')

    tracker.updateCustomerData({ value: 'x'.repeat(4000) })
    jasmine.clock().tick(BYTES_COMPUTATION_THROTTLING_DELAY)

    expect(display.warn).toHaveBeenCalledTimes(1)

    manager.stop()
  })

  it('should defer warnings until the compression status is known', () => {
    const manager = createCustomerDataTrackerManager(0)
    const tracker = manager.getOrCreateTracker('user')
    spyOn(display, 'warn')

    tracker.updateCustomerData({ value: 'x'.repeat(4000) })
    jasmine.clock().tick(BYTES_COMPUTATION_THROTTLING_DELAY)
    expect(display.warn).not.toHaveBeenCalled()

    manager.setCompressionStatus(2)

    expect(display.warn).toHaveBeenCalledTimes(1)

    manager.stop()
  })
})
