import {
  MAX_PENDING_MUTATION_APPROX_BYTES,
  MAX_PENDING_MUTATION_NODES,
  MAX_PENDING_MUTATION_RECORDS,
  MUTATION_PROCESS_MIN_DELAY,
  createMutationBatch
} from './mutationBatch'

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

  it('should discard an oversized raw mutation batch and request a reset', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const mutations = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS + 1 },
      () => ({ type: 'attributes' })
    )

    expect(batch.addMutations(mutations)).toBeFalse()
    batch.flush()

    expect(processMutationBatch).not.toHaveBeenCalled()
    expect(onOverflow).toHaveBeenCalledWith(
      jasmine.objectContaining({
        mutationRecordCount: MAX_PENDING_MUTATION_RECORDS + 1
      })
    )
  })

  it('should apply a node-count watermark to wide childList records', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const addedNodes = {
      length: MAX_PENDING_MUTATION_NODES + 1
    }

    expect(
      batch.addMutations([
        {
          type: 'childList',
          addedNodes,
          removedNodes: []
        }
      ])
    ).toBeFalse()

    expect(processMutationBatch).not.toHaveBeenCalled()
    expect(onOverflow).toHaveBeenCalled()
  })

  it('should apply an approximate byte watermark to large mutation values', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)

    expect(
      batch.addMutations([
        {
          type: 'characterData',
          oldValue: 'x'.repeat(MAX_PENDING_MUTATION_APPROX_BYTES)
        }
      ])
    ).toBeFalse()

    expect(processMutationBatch).not.toHaveBeenCalled()
    expect(onOverflow).toHaveBeenCalledWith(
      jasmine.objectContaining({
        mutationApproxBytes: jasmine.any(Number)
      })
    )
  })

  it('should release queued mutations when stopped', () => {
    const processMutationBatch = jasmine.createSpy('processMutationBatch')
    const batch = createMutationBatch(processMutationBatch)

    batch.addMutations([{ type: 'attributes' }])
    batch.stop()
    batch.flush()

    expect(processMutationBatch).not.toHaveBeenCalled()
  })

  it('should release the current batch before processing even when processing throws', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.callFake((mutations) => {
        if (mutations[0].id === 'unsafe') {
          throw new Error('unsafe mutation')
        }
      })
    const batch = createMutationBatch(processMutationBatch)

    batch.addMutations([{ type: 'attributes', id: 'unsafe' }])
    expect(() => batch.flush()).not.toThrow()

    batch.addMutations([{ type: 'attributes', id: 'safe' }])
    batch.flush()

    expect(processMutationBatch.calls.allArgs()).toEqual([
      [[{ type: 'attributes', id: 'unsafe' }]],
      [[{ type: 'attributes', id: 'safe' }]]
    ])
  })

  it('should request recovery after releasing a batch that throws', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.throwError('unsafe mutation')
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)

    batch.addMutations([{ type: 'attributes' }])
    batch.flush()

    expect(onOverflow).toHaveBeenCalledOnceWith({
      reason: 'mutation_processing_error',
      mutationRecordCount: 1
    })
  })
})
