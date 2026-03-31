import {
  createTaskQueue,
  MAX_EXECUTION_TIME_ON_TIMEOUT
} from './taskQueue'

describe('taskQueue', () => {
  let originalRequestIdleCallback
  let originalCancelIdleCallback
  let originalPerformanceNow

  beforeEach(() => {
    originalRequestIdleCallback = window.requestIdleCallback
    originalCancelIdleCallback = window.cancelIdleCallback
    originalPerformanceNow = performance.now
  })

  afterEach(() => {
    window.requestIdleCallback = originalRequestIdleCallback
    window.cancelIdleCallback = originalCancelIdleCallback
    performance.now = originalPerformanceNow
  })

  it('should schedule work once and execute queued tasks in order', () => {
    const requestIdleCallbackSpy = jasmine
      .createSpy('requestIdleCallback')
      .and.returnValue(1)
    const firstTask = jasmine.createSpy('firstTask')
    const secondTask = jasmine.createSpy('secondTask')

    window.requestIdleCallback = requestIdleCallbackSpy
    window.cancelIdleCallback = jasmine.createSpy('cancelIdleCallback')

    const queue = createTaskQueue()
    queue.push(firstTask)
    queue.push(secondTask)

    expect(requestIdleCallbackSpy.calls.count()).toBe(1)

    const run = requestIdleCallbackSpy.calls.mostRecent().args[0]
    run({
      didTimeout: false,
      timeRemaining: () => 10
    })

    expect(firstTask).toHaveBeenCalledBefore(secondTask)
    expect(secondTask).toHaveBeenCalled()
    expect(requestIdleCallbackSpy.calls.count()).toBe(1)
  })

  it('should reschedule remaining tasks when the idle deadline expires', () => {
    const requestIdleCallbackSpy = jasmine
      .createSpy('requestIdleCallback')
      .and.returnValue(1)
    const firstTask = jasmine.createSpy('firstTask')
    const secondTask = jasmine.createSpy('secondTask')

    window.requestIdleCallback = requestIdleCallbackSpy
    window.cancelIdleCallback = jasmine.createSpy('cancelIdleCallback')

    const queue = createTaskQueue()
    queue.push(firstTask)
    queue.push(secondTask)

    const firstRun = requestIdleCallbackSpy.calls.mostRecent().args[0]
    let callCount = 0
    firstRun({
      didTimeout: false,
      timeRemaining: () => {
        callCount += 1
        return callCount === 1 ? 1 : 0
      }
    })

    expect(firstTask).toHaveBeenCalled()
    expect(secondTask).not.toHaveBeenCalled()
    expect(requestIdleCallbackSpy.calls.count()).toBe(2)

    const secondRun = requestIdleCallbackSpy.calls.mostRecent().args[0]
    secondRun({
      didTimeout: false,
      timeRemaining: () => 10
    })

    expect(secondTask).toHaveBeenCalled()
  })

  it('should cap execution time when running after a timeout', () => {
    const requestIdleCallbackSpy = jasmine
      .createSpy('requestIdleCallback')
      .and.returnValue(1)
    const firstTask = jasmine.createSpy('firstTask')
    const secondTask = jasmine.createSpy('secondTask')
    const thirdTask = jasmine.createSpy('thirdTask')

    window.requestIdleCallback = requestIdleCallbackSpy
    window.cancelIdleCallback = jasmine.createSpy('cancelIdleCallback')
    performance.now = jasmine
      .createSpy('performance.now')
      .and.returnValues(
        0,
        5,
        MAX_EXECUTION_TIME_ON_TIMEOUT - 1,
        MAX_EXECUTION_TIME_ON_TIMEOUT + 1
      )

    const queue = createTaskQueue()
    queue.push(firstTask)
    queue.push(secondTask)
    queue.push(thirdTask)

    const run = requestIdleCallbackSpy.calls.mostRecent().args[0]
    run({
      didTimeout: true,
      timeRemaining: () => 0
    })

    expect(firstTask).toHaveBeenCalled()
    expect(secondTask).toHaveBeenCalled()
    expect(thirdTask).not.toHaveBeenCalled()
    expect(requestIdleCallbackSpy.calls.count()).toBe(2)
  })
})
