import { MUTATION_PROCESS_MIN_DELAY, createMutationBatch } from './mutationBatch'

describe('replay/record/mutationBatch', () => {
  let originalRequestIdleCallback
  let originalCancelIdleCallback
  let idleCallback
  let idleId
  let cancelIdleCallbackSpy

  beforeEach(() => {
    jasmine.clock().install()
    originalRequestIdleCallback = window.requestIdleCallback
    originalCancelIdleCallback = window.cancelIdleCallback
    idleCallback = undefined
    idleId = 41
    cancelIdleCallbackSpy = jasmine.createSpy('cancelIdleCallback')

    window.requestIdleCallback = jasmine
      .createSpy('requestIdleCallback')
      .and.callFake((callback) => {
        idleCallback = callback
        return idleId
      })
    window.cancelIdleCallback = cancelIdleCallbackSpy
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    window.requestIdleCallback = originalRequestIdleCallback
    window.cancelIdleCallback = originalCancelIdleCallback
  })

  it('should batch pending mutations and process them after the idle callback and throttle delay', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const mutationBatch = createMutationBatch(processMutationBatch)
    const firstMutation = { type: 'childList' }
    const secondMutation = { type: 'attributes' }

    mutationBatch.addMutations([firstMutation])
    mutationBatch.addMutations([secondMutation])

    expect(window.requestIdleCallback).toHaveBeenCalledTimes(1)
    expect(processMutationBatch).not.toHaveBeenCalled()

    idleCallback({ didTimeout: false, timeRemaining: () => 10 })
    jasmine.clock().tick(MUTATION_PROCESS_MIN_DELAY - 1)

    expect(processMutationBatch).not.toHaveBeenCalled()

    jasmine.clock().tick(1)

    expect(processMutationBatch).toHaveBeenCalledTimes(1)
    expect(processMutationBatch).toHaveBeenCalledWith([
      firstMutation,
      secondMutation
    ])
  })

  it('should flush immediately and clear pending mutations for the next batch', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const mutationBatch = createMutationBatch(processMutationBatch)
    const firstMutation = { type: 'characterData' }
    const secondMutation = { type: 'childList' }

    mutationBatch.addMutations([firstMutation])
    mutationBatch.flush()
    mutationBatch.addMutations([secondMutation])
    mutationBatch.flush()

    expect(processMutationBatch.calls.allArgs()).toEqual([
      [[firstMutation]],
      [[secondMutation]]
    ])
  })

  it('should cancel the scheduled idle callback and throttle timer when stopped', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const mutationBatch = createMutationBatch(processMutationBatch)

    mutationBatch.addMutations([{ type: 'childList' }])
    idleCallback({ didTimeout: false, timeRemaining: () => 5 })
    mutationBatch.stop()
    jasmine.clock().tick(MUTATION_PROCESS_MIN_DELAY)

    expect(cancelIdleCallbackSpy).toHaveBeenCalledWith(idleId)
    expect(processMutationBatch).not.toHaveBeenCalled()
  })
})
