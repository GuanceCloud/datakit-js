import {
  MAX_QUEUED_MUTATION_RECORDS,
  MAX_PENDING_MUTATION_APPROX_BYTES,
  MAX_PENDING_MUTATION_NODES,
  MAX_PENDING_MUTATION_RECORDS,
  MUTATION_CHUNK_MAX_NODES,
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
    expect(processMutationBatch).toHaveBeenCalledWith(
      [firstMutation, secondMutation],
      jasmine.objectContaining({
        $rTextReplacementByRemovedNode: jasmine.any(WeakMap)
      })
    )
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

    expect(
      processMutationBatch.calls.allArgs().map((args) => args[0])
    ).toEqual([[firstMutation], [secondMutation]])
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

  it('should preserve and sequentially chunk a callback above the pending record watermark', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const mutations = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS + 1 },
      (_, index) => ({
        type: 'attributes',
        attributeName: String(index)
      })
    )

    expect(batch.addMutations(mutations)).toBeTrue()
    while (batch.flush() === 'pending') {}

    const emittedMutations = [].concat.apply(
      [],
      processMutationBatch.calls.allArgs().map((args) => args[0])
    )
    const transactionArguments = processMutationBatch.calls
      .allArgs()
      .map((args) => args[1])
    expect(
      emittedMutations.map((mutation) => mutation.attributeName)
    ).toEqual(
      mutations.map((mutation) => mutation.attributeName)
    )
    transactionArguments.forEach((argument) => {
      expect(argument.transaction).toBe(
        transactionArguments[0].transaction
      )
      expect(argument.transaction.$rPureAdd).toBeFalse()
    })
    expect(
      transactionArguments.filter((argument) => argument.isLast).length
    ).toBe(1)
    expect(onOverflow).not.toHaveBeenCalled()
  })

  it('should keep a medium remove/add record whole beside a chunked attribute tail', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const target = document.createElement('div')
    const addedNodes = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES * 2 - 1 },
      () => document.createElement('span')
    )
    const removedNode = document.createElement('i')
    const structuralMutation = {
      type: 'childList',
      target,
      addedNodes,
      removedNodes: [removedNode]
    }
    const leadingAttributes = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES - 1 },
      (_, index) => ({
        type: 'attributes',
        attributeName: 'before-' + index
      })
    )
    const trailingAttributes = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS },
      (_, index) => ({
        type: 'attributes',
        attributeName: 'after-' + index
      })
    )

    expect(
      batch.addMutations(
        leadingAttributes.concat(
          structuralMutation,
          trailingAttributes
        )
      )
    ).toBeTrue()
    while (batch.flush() === 'pending') {}

    const structuralChunks = processMutationBatch.calls
      .allArgs()
      .filter((args) =>
        args[0].some((mutation) => mutation.type === 'childList')
      )
    expect(structuralChunks.length).toBe(1)
    const emittedStructuralMutation = structuralChunks[0][0].find(
      (mutation) => mutation.type === 'childList'
    )
    expect(emittedStructuralMutation.addedNodes).toEqual(addedNodes)
    expect(emittedStructuralMutation.removedNodes).toEqual([
      removedNode
    ])
    expect(emittedStructuralMutation.$rStructuralState).toBeUndefined()
    expect(onOverflow).not.toHaveBeenCalled()
  })

  it('should slice one structural record at the pending-node watermark as one atomic transaction', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const target = document.createElement('div')
    const removedNodes = Array.from({ length: 3 }, (_, index) => {
      const node = document.createElement('i')
      node.id = 'removed-' + index
      return node
    })
    const addedNodes = Array.from(
      { length: MAX_PENDING_MUTATION_NODES - removedNodes.length },
      (_, index) => {
        const node = document.createElement('span')
        node.id = 'added-' + index
        return node
      }
    )

    expect(
      batch.addMutations([
        {
          type: 'childList',
          target,
          addedNodes,
          removedNodes
        }
      ])
    ).toBeTrue()
    while (batch.flush() === 'pending') {}

    const calls = processMutationBatch.calls.allArgs()
    const structuralStates = calls
      .flatMap((args) => args[0])
      .map((mutation) => mutation.$rStructuralState)
    const transaction = calls[0][1].transaction
    expect(calls.length).toBeGreaterThan(1)
    expect(
      calls.flatMap((args) => args[0]).flatMap((mutation) => mutation.removedNodes)
    ).toEqual(removedNodes)
    expect(
      calls.flatMap((args) => args[0]).flatMap((mutation) => mutation.addedNodes)
    ).toEqual(addedNodes)
    structuralStates.forEach((state) => {
      expect(state).toBe(structuralStates[0])
    })
    calls.forEach((args) => {
      expect(args[1].transaction).toBe(transaction)
    })
    expect(calls.filter((args) => args[1].isLast).length).toBe(1)
    expect(onOverflow).not.toHaveBeenCalled()
  })

  it('should transaction-slice one sibling-add callback from its tail', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const target = document.createElement('div')
    const addedNodes = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES * 2 + 3 },
      (_, index) => {
        const node = document.createElement('span')
        node.id = String(index)
        target.appendChild(node)
        return node
      }
    )

    expect(
      batch.addMutations([
        {
          type: 'childList',
          target,
          addedNodes,
          removedNodes: []
        }
      ])
    ).toBeTrue()
    while (batch.flush() === 'pending') {}

    const emittedNodeIds = [].concat.apply(
      [],
      processMutationBatch.calls
        .allArgs()
        .map((args) => args[0][0].addedNodes.map((node) => node.id))
    )
    const expectedNodeIds = []
    const nodesPerChunk = MUTATION_CHUNK_MAX_NODES - 1
    for (
      let chunkEnd = addedNodes.length;
      chunkEnd > 0;
      chunkEnd -= nodesPerChunk
    ) {
      const chunkStart = Math.max(chunkEnd - nodesPerChunk, 0)
      expectedNodeIds.push(
        ...addedNodes.slice(chunkStart, chunkEnd).map((node) => node.id)
      )
    }
    expect(emittedNodeIds).toEqual(expectedNodeIds)
    expect(processMutationBatch.calls.count()).toBeGreaterThan(1)
    const transactionArguments = processMutationBatch.calls
      .allArgs()
      .map((args) => args[1])
    transactionArguments.forEach((argument) => {
      expect(argument.transaction).toBe(
        transactionArguments[0].transaction
      )
      expect(argument.transaction.$rPureAdd).toBeTrue()
    })
    expect(
      transactionArguments.filter((argument) => argument.isLast).length
    ).toBe(1)
    expect(onOverflow).not.toHaveBeenCalled()
  })

  it('should keep non-monotonic same-target inserts in one forward atomic transaction', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const batch = createMutationBatch(processMutationBatch)
    const target = document.createElement('div')
    const appendedNodes = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES - 1 },
      (_, index) => {
        const node = document.createElement('span')
        node.id = 'appended-' + index
        target.appendChild(node)
        return node
      }
    )
    const insertedNode = document.createElement('em')
    insertedNode.id = 'inserted-before'
    target.insertBefore(insertedNode, appendedNodes[0])

    batch.addMutations([
      {
        type: 'childList',
        target,
        addedNodes: appendedNodes,
        removedNodes: []
      },
      {
        type: 'childList',
        target,
        addedNodes: [insertedNode],
        removedNodes: []
      }
    ])
    while (batch.flush() === 'pending') {}

    const transactionArguments = processMutationBatch.calls
      .allArgs()
      .map((args) => args[1])
    transactionArguments.forEach((argument) => {
      expect(argument.transaction.$rPureAdd).toBeFalse()
      expect(argument.transaction).toBe(
        transactionArguments[0].transaction
      )
    })
    const emittedNodeIds = processMutationBatch.calls
      .allArgs()
      .flatMap((args) => args[0])
      .flatMap((mutation) => mutation.addedNodes)
      .map((node) => node.id)
    expect(emittedNodeIds).toEqual(
      appendedNodes.map((node) => node.id).concat(insertedNode.id)
    )
    expect(
      transactionArguments.filter((argument) => argument.isLast).length
    ).toBe(1)
  })

  it('should keep queued native callbacks independent instead of merging them into one transaction', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const batch = createMutationBatch(processMutationBatch)
    const target = {}
    const createMutation = (prefix) => {
      const addedNodes = Array.from({ length: 20 }, (_, index) => ({
        id: prefix + index,
        parentNode: target
      }))
      return {
        type: 'childList',
        target,
        addedNodes,
        removedNodes: []
      }
    }
    const firstMutation = createMutation('first-')
    const secondMutation = createMutation('second-')

    batch.addMutations([firstMutation])
    batch.addMutations([secondMutation])
    while (batch.flush() === 'pending') {}

    expect(
      processMutationBatch.calls.allArgs().map((args) => args[0])
    ).toEqual([[firstMutation], [secondMutation]])
  })

  it('should keep a bounded two-callback merge non-transactional', () => {
    const processMutationBatch = jasmine.createSpy(
      'processMutationBatch'
    )
    const batch = createMutationBatch(processMutationBatch)
    const target = {}
    const createMutation = (prefix) => ({
      type: 'childList',
      target,
      addedNodes: Array.from({ length: 16 }, (_, index) => ({
        id: prefix + index,
        parentNode: target
      })),
      removedNodes: []
    })
    const firstMutation = createMutation('first-')
    const secondMutation = createMutation('second-')

    batch.addMutations([firstMutation])
    batch.addMutations([secondMutation])
    batch.flush()

    expect(processMutationBatch).toHaveBeenCalledOnceWith(
      [firstMutation, secondMutation],
      jasmine.objectContaining({
        $rTextReplacementByRemovedNode: jasmine.any(WeakMap)
      })
    )
  })

  it('should discard only an oversized oldValue while preserving its mutation', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)

    expect(
      batch.addMutations([
        {
          type: 'characterData',
          oldValue: 'x'.repeat(MAX_PENDING_MUTATION_APPROX_BYTES)
        }
      ])
    ).toBeTrue()
    while (batch.flush() === 'pending') {}

    expect(processMutationBatch).toHaveBeenCalledOnceWith(
      [
        jasmine.objectContaining({
          type: 'characterData',
          oldValue: undefined
        })
      ],
      jasmine.objectContaining({ isLast: true })
    )
    expect(onOverflow).not.toHaveBeenCalled()
  })

  it('should commit a childList cursor only after the exact-cap slice is pushed', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const batch = createMutationBatch(processMutationBatch)
    const firstNodes = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES - 2 },
      (_, index) => ({ id: 'first-' + index })
    )
    const boundaryNode = { id: 'boundary' }

    batch.addMutations([
      {
        type: 'childList',
        target: {},
        addedNodes: firstNodes,
        removedNodes: []
      },
      {
        type: 'childList',
        target: {},
        addedNodes: [boundaryNode],
        removedNodes: []
      }
    ])
    while (batch.flush() === 'pending') {}

    const emittedNodes = [].concat.apply(
      [],
      processMutationBatch.calls
        .allArgs()
        .map((args) => args[0])
        .map((mutationChunk) =>
          [].concat.apply(
            [],
            mutationChunk.map((mutation) => mutation.addedNodes)
          )
        )
    )
    expect(emittedNodes.length).toBe(MUTATION_CHUNK_MAX_NODES - 1)
    expect(emittedNodes[emittedNodes.length - 1]).toBe(boundaryNode)
  })

  it('should recover once when the aggregate queued record cap is exceeded', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(true)
    const onOverflow = jasmine.createSpy('onOverflow')
    const batch = createMutationBatch(processMutationBatch, onOverflow)
    const mutations = Array.from(
      { length: MAX_QUEUED_MUTATION_RECORDS + 1 },
      () => ({ type: 'attributes' })
    )

    expect(batch.addMutations(mutations)).toBeFalse()
    expect(batch.hasPending()).toBeFalse()
    expect(onOverflow).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'raw_mutation_queue_watermark'
      })
    )
  })

  it('should report a chunk failure and atomically discard the queued generation', () => {
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.returnValue(false)
    const batch = createMutationBatch(processMutationBatch)
    const mutations = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS + 1 },
      (_, index) => ({
        type: 'attributes',
        attributeName: String(index)
      })
    )

    expect(batch.addMutations(mutations)).toBeTrue()
    expect(batch.flush()).toBeFalse()
    expect(batch.hasPending()).toBeFalse()
    jasmine.clock().tick(0)
    expect(processMutationBatch).toHaveBeenCalledTimes(1)
  })

  it('should not release chunked work twice after a synchronous reset', () => {
    let batch
    const processMutationBatch = jasmine
      .createSpy('processMutationBatch')
      .and.callFake(() => {
        batch.reset()
        return true
      })
    const onOverflow = jasmine.createSpy('onOverflow')
    batch = createMutationBatch(processMutationBatch, onOverflow)
    const chunkedMutations = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS + 1 },
      (_, index) => ({
        type: 'attributes',
        attributeName: String(index)
      })
    )

    expect(batch.addMutations(chunkedMutations)).toBeTrue()
    // Force a second work item behind the chunked transaction. A synchronous
    // reset from the first chunk must discard it with the old generation.
    expect(
      batch.addMutations([
        { type: 'attributes', attributeName: 'stale-after-reset' }
      ])
    ).toBeTrue()
    expect(batch.flush()).toBeFalse()
    expect(batch.hasPending()).toBeFalse()
    expect(processMutationBatch).toHaveBeenCalledTimes(1)
    jasmine.clock().tick(0)
    expect(processMutationBatch).toHaveBeenCalledTimes(1)

    const overflowingMutations = Array.from(
      { length: MAX_QUEUED_MUTATION_RECORDS + 1 },
      () => ({ type: 'attributes' })
    )
    expect(batch.addMutations(overflowingMutations)).toBeFalse()
    expect(onOverflow).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'raw_mutation_queue_watermark'
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
    expect(batch.flush()).toBeFalse()

    batch.addMutations([{ type: 'attributes', id: 'safe' }])
    batch.flush()

    expect(
      processMutationBatch.calls.allArgs().map((args) => args[0])
    ).toEqual([
      [{ type: 'attributes', id: 'unsafe' }],
      [{ type: 'attributes', id: 'safe' }]
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
