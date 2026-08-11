import {
  NodePrivacyLevel,
  PRIVACY_ATTR_NAME,
  PRIVACY_ATTR_VALUE_HIDDEN
} from '../../../constants'
import {
  createMutationTasksController,
  MAX_MUTATION_CURRENT_SOURCE_CHARACTERS,
  MUTATION_NORMALIZATION_MAX_DURATION_MS,
  MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS,
  MAX_MUTATION_ROOT_TASK_REFRESH_COUNT,
  MAX_DEFERRED_MUTATION_ROOT_TASKS,
  MAX_PENDING_MUTATION_GROUPS,
  MAX_PENDING_MUTATION_ROOT_APPROX_BYTES,
  MAX_PENDING_MUTATION_ROOT_TASKS,
  MAX_REMOVED_SUBTREE_TRAVERSAL_NODES,
  processMutations,
  startMutationObserver
} from './mutationObserver'
import {
  SERIALIZATION_MAX_NODE_SOURCE_LENGTH,
  SerializationContextStatus
} from './serialize'
import {
  MAX_PENDING_MUTATION_NODES,
  MAX_PENDING_MUTATION_RECORDS,
  MUTATION_CHUNK_MAX_NODES,
  MUTATION_PROCESS_MIN_DELAY
} from './mutationBatch'
import {
  getSerializedNodeId,
  setSerializedNodeId
} from './serializationUtils'

describe('replay/record/mutationObserver', () => {
  let OriginalMutationObserver
  let originalRequestIdleCallback
  let originalCancelIdleCallback
  let observedCallback
  let observedTarget
  let disconnect
  let takeRecords
  var ASYNC_MUTATION_TICK = MUTATION_PROCESS_MIN_DELAY + 20

  function markSerializedAncestors(node, startId) {
    let current = node
    let nextId = startId

    while (current) {
      setSerializedNodeId(current, nextId)
      nextId += 1
      current = current.parentNode
    }
  }

  beforeEach(() => {
    OriginalMutationObserver = window.MutationObserver
    originalRequestIdleCallback = window.requestIdleCallback
    originalCancelIdleCallback = window.cancelIdleCallback
    disconnect = jasmine.createSpy('disconnect')
    takeRecords = jasmine.createSpy('takeRecords').and.returnValue([])
    observedCallback = undefined
    observedTarget = undefined

    function FakeMutationObserver(callback) {
      observedCallback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((target) => {
        observedTarget = target
      })
      this.disconnect = disconnect
      this.takeRecords = takeRecords
    }

    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: FakeMutationObserver
    })
  })

  afterEach(() => {
    try {
      jasmine.clock().uninstall()
    } catch (error) {}
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: OriginalMutationObserver
    })
    window.requestIdleCallback = originalRequestIdleCallback
    window.cancelIdleCallback = originalCancelIdleCallback
  })

  it('should bound pending atomic mutation groups', () => {
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      {},
      undefined,
      mutationOverflowCallback
    )

    for (let index = 0; index < MAX_PENDING_MUTATION_GROUPS; index += 1) {
      expect(controller.createMutationGroup()).toBeDefined()
    }
    expect(controller.createMutationGroup()).toBeUndefined()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'mutation_group_watermark',
        mutationRecordCount: MAX_PENDING_MUTATION_GROUPS + 1
      })
    )
    expect(controller.isOverflowed()).toBeTrue()

    controller.stop()
  })

  it('should not process stale records after synchronous group-overflow recovery resets the controller', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 35)
    parent.setAttribute('data-after-overflow', 'stale')
    const mutationCallback = jasmine.createSpy('mutationCallback')
    let controller
    const mutationOverflowCallback = jasmine
      .createSpy('mutationOverflowCallback')
      .and.callFake(() => controller.reset())
    controller = createMutationTasksController(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      {},
      undefined,
      mutationOverflowCallback
    )
    for (let index = 0; index < MAX_PENDING_MUTATION_GROUPS; index += 1) {
      controller.createMutationGroup()
    }

    processMutations(
      [
        {
          type: 'attributes',
          target: parent,
          attributeName: 'data-after-overflow',
          oldValue: null
        }
      ],
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      {},
      controller
    )

    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'mutation_group_watermark'
      })
    )
    expect(controller.getOverflowCount()).toBe(1)
    expect(controller.isOverflowed()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should only drop serializer tasks owned by the exhausted mutation group', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 40)
    const firstRoot = document.createElement('section')
    const secondRoot = document.createElement('article')
    parent.appendChild(firstRoot)
    parent.appendChild(secondRoot)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      configuration,
      shadowRootsController
    )
    const firstGroup = controller.createMutationGroup()
    const secondGroup = controller.createMutationGroup()
    const addRootTask = (root, mutationGroup) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        mutationGroup
      })

    expect(addRootTask(firstRoot, firstGroup)).toBeTrue()
    expect(addRootTask(secondRoot, secondGroup)).toBeTrue()

    controller.dropMutationGroupTasks(secondGroup)

    expect(controller.findPendingRootTask(firstRoot)).toBeDefined()
    expect(controller.findPendingRootTask(secondRoot)).toBeUndefined()

    controller.cancelMutationGroup(firstGroup)
    controller.cancelMutationGroup(secondGroup)
    controller.stop()
    parent.remove()
  })

  it('should emit an earlier atomic group before a later ungrouped add that references it', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 45)
    const groupedRoot = document.createElement('section')
    parent.appendChild(groupedRoot)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )
    const mutationGroup = controller.createMutationGroup()
    const addRootTask = (root, group) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        mutationGroup: group
      })

    expect(addRootTask(groupedRoot, mutationGroup)).toBeTrue()
    controller.completeMutationGroup(mutationGroup, {
      adds: [],
      removes: [{ parentId: 45, id: 900045 }],
      texts: [],
      attributes: []
    })

    const laterRoot = document.createElement('article')
    parent.insertBefore(laterRoot, groupedRoot)
    expect(addRootTask(laterRoot)).toBeTrue()
    expect(controller.flush()).toBeTrue()

    expect(mutationCallback).toHaveBeenCalledTimes(2)
    const groupedPayload = mutationCallback.calls.argsFor(0)[0]
    const laterPayload = mutationCallback.calls.argsFor(1)[0]
    expect(groupedPayload.removes).toEqual([
      { parentId: 45, id: 900045 }
    ])
    expect(groupedPayload.adds.length).toBe(1)
    expect(groupedPayload.adds[0].node.tagName).toBe('section')
    expect(laterPayload.removes).toEqual([])
    expect(laterPayload.adds.length).toBe(1)
    expect(laterPayload.adds[0].node.tagName).toBe('article')
    expect(laterPayload.adds[0].nextId).toBe(
      groupedPayload.adds[0].node.id
    )

    controller.stop()
    parent.remove()
  })

  it('should keep a later taskless atomic group behind an earlier ungrouped add', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 46)
    const earlierRoot = document.createElement('section')
    parent.appendChild(earlierRoot)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )

    expect(
      controller.addPendingRootTask(earlierRoot, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    const laterGroup = controller.createMutationGroup()
    controller.completeMutationGroup(laterGroup, {
      adds: [],
      removes: [],
      texts: [],
      attributes: [
        {
          id: 46,
          attributes: { 'data-later-group': 'true' }
        }
      ]
    })

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(controller.flush()).toBeTrue()
    expect(mutationCallback).toHaveBeenCalledTimes(2)
    expect(mutationCallback.calls.argsFor(0)[0].adds.length).toBe(1)
    expect(mutationCallback.calls.argsFor(0)[0].adds[0].node.tagName).toBe(
      'section'
    )
    expect(mutationCallback.calls.argsFor(1)[0].attributes).toEqual([
      {
        id: 46,
        attributes: { 'data-later-group': 'true' }
      }
    ])

    controller.stop()
    parent.remove()
  })

  it('should remove shadow roots from the controller when hosts are removed', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1)

    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    shadowRoot.appendChild(document.createElement('span'))

    const removeShadowRoot = jasmine.createSpy('removeShadowRoot')
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot },
      parent
    )

    expect(observedTarget).toBe(parent)

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [],
        removedNodes: [host]
      }
    ])
    observer.flush()

    expect(removeShadowRoot).toHaveBeenCalledWith(shadowRoot)
    expect(disconnect).not.toHaveBeenCalled()

    observer.stop()
    parent.remove()
  })

  it('should deactivate native mutation work before physical cleanup', () => {
    const cancelIdleCallback = jasmine.createSpy('cancelIdleCallback')
    window.requestIdleCallback = jasmine
      .createSpy('requestIdleCallback')
      .and.returnValue(1)
    window.cancelIdleCallback = cancelIdleCallback
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationActivityCallback = jasmine.createSpy(
      'mutationActivityCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      undefined,
      mutationActivityCallback
    )
    const mutation = {
      type: 'childList',
      target: parent,
      addedNodes: [],
      removedNodes: []
    }

    observedCallback([mutation])
    mutationActivityCallback.calls.reset()
    observer.deactivate()
    observedCallback([mutation])

    expect(cancelIdleCallback).toHaveBeenCalledTimes(1)
    expect(observer.flush()).toBeTrue()
    expect(mutationActivityCallback).not.toHaveBeenCalled()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(takeRecords).not.toHaveBeenCalled()
    expect(disconnect).not.toHaveBeenCalled()

    observer.stop()
    expect(disconnect).toHaveBeenCalledTimes(1)
    parent.remove()
  })

  it('should gate native mutation work when its source generation is inactive', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationActivityCallback = jasmine.createSpy(
      'mutationActivityCallback'
    )
    const isSourceActive = jasmine
      .createSpy('isSourceActive')
      .and.returnValue(false)
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      undefined,
      mutationActivityCallback,
      undefined,
      undefined,
      undefined,
      isSourceActive
    )
    const mutation = {
      type: 'childList',
      target: parent,
      addedNodes: [],
      removedNodes: []
    }

    observedCallback([mutation])

    expect(isSourceActive).toHaveBeenCalled()
    expect(mutationActivityCallback).not.toHaveBeenCalled()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(observer.flush()).toBeTrue()
    expect(takeRecords).not.toHaveBeenCalled()

    observer.stop()
    parent.remove()
  })

  it('should remove nested shadow-root controllers with their outer host', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 3)

    const outerHost = document.createElement('div')
    const outerShadowRoot = outerHost.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('span')
    const innerShadowRoot = innerHost.attachShadow({ mode: 'open' })
    innerShadowRoot.appendChild(document.createElement('em'))
    outerShadowRoot.appendChild(innerHost)
    parent.appendChild(outerHost)
    parent.removeChild(outerHost)

    const removeShadowRoot = jasmine.createSpy('removeShadowRoot')
    const observer = startMutationObserver(
      jasmine.createSpy('mutationCallback'),
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [],
        removedNodes: [outerHost]
      }
    ])
    observer.flush()

    expect(removeShadowRoot.calls.allArgs()).toEqual([
      [outerShadowRoot],
      [innerShadowRoot]
    ])
    observer.stop()
    parent.remove()
  })

  it('should remove nested shadow roots without recursive stack growth', () => {
    // Exercise the iterative traversal depth without coupling this stack-safety
    // assertion to the normalization wall-clock budget under a loaded runner.
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 5)
    const removedRoot = document.createElement('div')
    let current = removedRoot
    for (
      let depth = 0;
      depth < MAX_REMOVED_SUBTREE_TRAVERSAL_NODES - 100;
      depth += 1
    ) {
      const child = document.createElement('div')
      current.appendChild(child)
      current = child
    }
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    current.appendChild(host)
    parent.appendChild(removedRoot)
    parent.removeChild(removedRoot)
    const removeShadowRoot = jasmine.createSpy('removeShadowRoot')
    const observer = startMutationObserver(
      jasmine.createSpy('mutationCallback'),
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot },
      parent
    )

    expect(() => {
      observedCallback([
        {
          type: 'childList',
          target: parent,
          addedNodes: [],
          removedNodes: [removedRoot]
        }
      ])
      observer.flush()
    }).not.toThrow()
    expect(removeShadowRoot).toHaveBeenCalledWith(shadowRoot)
  })

  it('should skip attribute and text mutations for nodes serialized by a childList mutation', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 10)

    const child = document.createElement('div')
    child.setAttribute('data-test', 'new')
    const textNode = document.createTextNode('new text')
    child.appendChild(textNode)
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      },
      {
        type: 'attributes',
        target: child,
        attributeName: 'data-test',
        oldValue: null
      },
      {
        type: 'characterData',
        target: textNode,
        oldValue: 'old text'
      }
    ])
    observer.flush()

    expect(mutationCallback).toHaveBeenCalledTimes(1)
    expect(mutationCallback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        adds: [
          jasmine.objectContaining({
            parentId: 10,
            node: jasmine.objectContaining({
              tagName: 'div'
            })
          })
        ],
        removes: [],
        texts: [],
        attributes: []
      })
    )
  })

  it('should locally drop deep childList serialization without recursive stack growth', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 100)

    const child = document.createElement('div')
    let current = child
    for (let i = 0; i < 1500; i += 1) {
      const nested = document.createElement('div')
      current.appendChild(nested)
      current = nested
    }
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    let observer
    const mutationOverflowCallback = jasmine
      .createSpy('mutationOverflowCallback')
      .and.callFake(() => observer.reset())
    observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    expect(() => {
      observedCallback([
        {
          type: 'childList',
          target: parent,
          addedNodes: [child],
          removedNodes: []
        }
      ])
      observer.flush()
    }).not.toThrow()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
  })

  it('should publish a child node after truncating an oversized text value', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 145)

    const child = document.createElement('div')
    child.appendChild(
      document.createTextNode(
        'x'.repeat(SERIALIZATION_MAX_NODE_SOURCE_LENGTH + 1)
      )
    )
    parent.appendChild(child)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])
    expect(observer.flush()).toBeTrue()

    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const serializedText =
      mutationCallback.calls.mostRecent().args[0].adds[0].node
        .childNodes[0].textContent
    expect(serializedText.length).toBe(
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    expect(serializedText.endsWith('…')).toBeTrue()
    observer.stop()
    parent.remove()
  })

  it('should preserve one raw observer callback across mutation chunks', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 150)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    parent.setAttribute('data-state', 'ready')
    observedCallback(
      Array.from(
        { length: MAX_PENDING_MUTATION_RECORDS + 1 },
        () => ({
          type: 'attributes',
          target: parent,
          attributeName: 'data-state',
          oldValue: null
        })
      )
    )

    expect(observer.flush()).toBeTrue()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    observer.stop()
    parent.remove()
  })

  it('should finish a bounded contiguous append batch after a short clock interruption', () => {
    let nowCalls = 0
    spyOn(performance, 'now').and.callFake(() => {
      nowCalls += 1
      // Queue slicing and normalization read the clock before the first
      // normalization budget check.
      return nowCalls <= 3 ? 0 : 10
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 154)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )
    const mutations = Array.from({ length: 12 }, () => {
      const addedNodes = Array.from({ length: 4 }, () => {
        const node = document.createElement('section')
        parent.appendChild(node)
        return node
      })
      return {
        type: 'childList',
        target: parent,
        addedNodes,
        removedNodes: []
      }
    })

    observedCallback(mutations)
    let flushResult
    do {
      flushResult = observer.flush()
    } while (flushResult === 'pending')

    expect(flushResult).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(
      mutationCallback
        .calls
        .allArgs()
        .reduce((count, args) => count + args[0].adds.length, 0)
    ).toBe(48)
    observer.stop()
    parent.remove()
  })

  it('should finish a small mixed child-list batch after a short clock interruption', () => {
    let nowCalls = 0
    spyOn(performance, 'now').and.callFake(() => {
      nowCalls += 1
      // Queue slicing and normalization read the clock before the first
      // budget check. Every later check observes the interrupted 10ms clock.
      return nowCalls <= 3 ? 0 : 10
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 154)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )
    const removedNodes = Array.from({ length: 5 }, (_, index) => {
      const node = document.createElement('aside')
      parent.appendChild(node)
      setSerializedNodeId(node, 1600 + index)
      return node
    })
    const mutations = Array.from({ length: 8 }, (_, mutationIndex) => {
      const addedNodes = Array.from({ length: 3 }, () => {
        const node = document.createElement('section')
        parent.appendChild(node)
        return node
      })
      const removedNodesForMutation =
        mutationIndex < removedNodes.length
          ? [removedNodes[mutationIndex]]
          : []
      removedNodesForMutation.forEach((node) => parent.removeChild(node))
      return {
        type: 'childList',
        target: parent,
        addedNodes,
        removedNodes: removedNodesForMutation
      }
    })

    observedCallback(mutations)
    let flushResult
    do {
      flushResult = observer.flush()
    } while (flushResult === 'pending')

    expect(flushResult).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(
      mutationCallback
        .calls
        .allArgs()
        .reduce((count, args) => count + args[0].adds.length, 0)
    ).toBe(24)
    expect(
      mutationCallback
        .calls
        .allArgs()
        .reduce((count, args) => count + args[0].removes.length, 0)
    ).toBe(5)
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    observer.stop()
    parent.remove()
  })

  it('should transaction-slice a wide pure-add batch across a short clock interruption', () => {
    let nowCalls = 0
    spyOn(performance, 'now').and.callFake(() => {
      nowCalls += 1
      return nowCalls <= 3 ? 0 : 10
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1541)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )
    const addedNodes = Array.from({ length: 384 }, () => {
      const node = document.createElement('section')
      parent.appendChild(node)
      return node
    })

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes,
        removedNodes: []
      }
    ])

    let flushResult
    do {
      flushResult = observer.flush()
    } while (flushResult === 'pending')

    expect(flushResult).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(
      mutationCallback.calls.allArgs().reduce(
        (count, args) => count + args[0].adds.length,
        0
      )
    ).toBe(addedNodes.length)
    const emittedNodeIds = new Set(
      mutationCallback.calls
        .allArgs()
        .flatMap((args) => args[0].adds)
        .map((add) => add.node.id)
    )
    addedNodes.forEach((node) =>
      expect(emittedNodeIds.has(getSerializedNodeId(node))).toBeTrue()
    )
    observer.stop()
    parent.remove()
  })

  it('should reject an over-budget normalization batch atomically and keep observing', () => {
    let nowCalls = 0
    const performanceNowSpy = spyOn(performance, 'now').and.callFake(() => {
      nowCalls += 1
      return nowCalls < 4 ? 0 : 10
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 155)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    let observer
    const mutationOverflowCallback = jasmine
      .createSpy('mutationOverflowCallback')
      .and.callFake(() => observer.reset())
    observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback(
      Array.from({ length: 96 }, (_, index) => ({
        type: 'attributes',
        target: parent,
        attributeName: 'data-state-' + index,
        oldValue: null
      }))
    )
    observer.flush()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'mutation_normalization_budget',
        mutationRecordCount: 96
      })
    )

    performanceNowSpy.and.returnValue(20)
    parent.setAttribute('data-after-budget', 'ready')
    observedCallback([
      {
        type: 'attributes',
        target: parent,
        attributeName: 'data-after-budget',
        oldValue: null
      }
    ])
    observer.flush()

    expect(mutationCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        attributes: [
          jasmine.objectContaining({
            id: 155,
            attributes: { 'data-after-budget': 'ready' }
          })
        ]
      })
    )
    observer.stop()
    parent.remove()
  })

  it('should not pre-scan every node in a wide pure-add batch for publication state', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1550)
    const addedNodes = Array.from({ length: 128 }, () => {
      const node = document.createElement('span')
      parent.appendChild(node)
      return node
    })
    const isNodePublished = jasmine
      .createSpy('isNodePublished')
      .and.returnValue(false)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      configuration,
      shadowRootsController
    )

    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes,
          removedNodes: []
        }
      ],
      jasmine.createSpy('normalizedMutationCallback'),
      configuration,
      shadowRootsController,
      controller,
      undefined,
      isNodePublished
    )

    // Publication is checked once when each root is admitted. An eager
    // pre-scan would double these calls and revisit the full NodeList before
    // the normalization budget can yield.
    expect(isNodePublished.calls.count()).toBe(addedNodes.length)
    controller.stop()
    parent.remove()
  })

  it('should not publish a structural prefix when normalization exceeds its deadline', () => {
    let nowCalls = 0
    spyOn(performance, 'now').and.callFake(() => {
      nowCalls += 1
      return nowCalls < 4 ? 0 : 10
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1551)
    const removedNode = document.createElement('section')
    parent.appendChild(removedNode)
    setSerializedNodeId(removedNode, 1552)
    parent.removeChild(removedNode)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )
    const mutations = Array.from({ length: 96 }, (_, index) => ({
      type: 'attributes',
      target: parent,
      attributeName: 'data-before-removal-' + index,
      oldValue: null
    }))
    mutations.push({
      type: 'childList',
      target: parent,
      addedNodes: [],
      removedNodes: [removedNode]
    })

    observedCallback(mutations)
    expect(observer.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'mutation_normalization_budget',
        mutationRecordCount: 97
      })
    )
    observer.stop()
    parent.remove()
  })

  it('should reject all attributes when normalization exceeds its deadline', () => {
    let nowCalls = 0
    const performanceNowSpy = spyOn(performance, 'now').and.callFake(() => {
      nowCalls += 1
      // Let classification and pending-task filtering finish, then expire in
      // processAttributesMutations itself.
      return nowCalls < 8 ? 0 : 10
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 156)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback(
      Array.from({ length: 96 }, (_, index) => {
        const attributeName = 'data-materialized-' + index
        parent.setAttribute(attributeName, String(index))
        return {
          type: 'attributes',
          target: parent,
          attributeName,
          oldValue: null
        }
      })
    )
    expect(observer.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'mutation_normalization_budget',
        mutationRecordCount: 96
      })
    )

    performanceNowSpy.and.returnValue(20)
    parent.setAttribute('data-after-materialization-budget', 'ready')
    observedCallback([
      {
        type: 'attributes',
        target: parent,
        attributeName: 'data-after-materialization-budget',
        oldValue: null
      }
    ])
    observer.flush()

    expect(mutationCallback.calls.count()).toBe(1)
    expect(
      mutationCallback.calls.mostRecent().args[0]
    ).toEqual(
      jasmine.objectContaining({
        attributes: [
          jasmine.objectContaining({
            id: 156,
            attributes: {
              'data-after-materialization-budget': 'ready'
            }
          })
        ]
      })
    )
    observer.stop()
    parent.remove()
  })

  it('should cancel unpublished root work before reporting a normalization timeout', () => {
    let normalizationExpired = false
    let expireOnSerialization = true
    spyOn(performance, 'now').and.callFake(() =>
      normalizationExpired ? 10 : 0
    )
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 157)
    const child = document.createElement('section')
    child.setAttribute('data-over-budget-root', 'true')
    parent.appendChild(child)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const mutationNodeSerializationCallback = jasmine
      .createSpy('mutationNodeSerializationCallback')
      .and.callFake(() => {
        // The root task is now admitted. Expire the next normalization time
        // check so rollback covers already-created unpublished work.
        if (expireOnSerialization) {
          normalizationExpired = true
        }
      })
    const rollbackProvisionalShadowRoots = jasmine.createSpy(
      'rollbackProvisionalShadowRoots'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      {
        removeShadowRoot: jasmine.createSpy('removeShadowRoot'),
        rollbackProvisionalShadowRoots
      },
      parent,
      undefined,
      mutationOverflowCallback,
      undefined,
      mutationNodeSerializationCallback
    )
    const attributeMutations = Array.from({ length: 160 }, (_, index) => {
      const attributeName = 'data-budget-tail-' + index
      parent.setAttribute(attributeName, String(index))
      return {
        type: 'attributes',
        target: parent,
        attributeName,
        oldValue: null
      }
    })

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      },
      ...attributeMutations
    ])
    expect(observer.flush()).toBeFalse()

    const publicationToken =
      mutationNodeSerializationCallback.calls.first().args[2]
    expect(publicationToken.$rCanceled).toBeTrue()
    expect(rollbackProvisionalShadowRoots).toHaveBeenCalledOnceWith(
      publicationToken
    )
    expect(
      mutationCallback.calls
        .allArgs()
        .some((args) =>
          args[0].adds.some(
            (add) =>
              add.node.attributes['data-over-budget-root'] === 'true'
          )
        )
    ).toBeFalse()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith(
      jasmine.objectContaining({
        reason: 'mutation_normalization_budget',
        mutationRecordCount: 161
      })
    )

    normalizationExpired = false
    expireOnSerialization = false
    const laterRoot = document.createElement('aside')
    laterRoot.setAttribute('data-after-root-rollback', 'ready')
    parent.appendChild(laterRoot)
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [laterRoot],
        removedNodes: []
      }
    ])
    observer.flush()

    expect(
      mutationCallback.calls
        .allArgs()
        .some((args) =>
          args[0].adds.some(
            (add) =>
              add.node.attributes['data-after-root-rollback'] === 'ready'
          )
        )
    ).toBeTrue()
    observer.stop()
    parent.remove()
  })

  it('should mask and truncate one oversized current text value', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const textNode = document.createTextNode('old')
    parent.appendChild(textNode)
    document.body.appendChild(parent)
    markSerializedAncestors(textNode, 158)
    const shouldMaskNode = jasmine.createSpy('shouldMaskNode').and.returnValue(
      true
    )
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      {
        defaultPrivacyLevel: NodePrivacyLevel.MASK,
        shouldMaskNode
      },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    textNode.textContent = 'private-value '.repeat(
      SERIALIZATION_MAX_NODE_SOURCE_LENGTH
    )
    observedCallback([
      {
        type: 'characterData',
        target: textNode,
        oldValue: 'old'
      }
    ])
    observer.flush()

    expect(shouldMaskNode).toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const serializedText =
      mutationCallback.calls.mostRecent().args[0].texts[0].value
    expect(serializedText.length).toBeLessThanOrEqual(
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    expect(serializedText).not.toContain('private-value')
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    observer.stop()
    parent.remove()
  })

  it('should bound aggregate current values across a chunked transaction', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 159)
    const currentValueLength = 1024
    const mutationCount =
      Math.floor(
        MAX_MUTATION_CURRENT_SOURCE_CHARACTERS / currentValueLength
      ) + 1
    const mutations = []
    for (let index = 0; index < mutationCount; index += 1) {
      const textNode = document.createTextNode(
        'x'.repeat(currentValueLength)
      )
      parent.appendChild(textNode)
      setSerializedNodeId(textNode, 10000 + index)
      mutations.push({
        type: 'characterData',
        target: textNode,
        oldValue: ''
      })
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    let observer
    const mutationOverflowCallback = jasmine
      .createSpy('mutationOverflowCallback')
      .and.callFake(() => observer.reset())
    observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback(mutations)
    expect(observer.flush()).toBeFalse()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'mutation_current_source_watermark',
      mutationApproxBytes:
        mutationCount * currentValueLength * 2
    })
    observer.stop()
    parent.remove()
  })

  it('should deduplicate text and attributes across transaction chunks', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const textNode = document.createTextNode('final text')
    parent.appendChild(textNode)
    parent.setAttribute('data-final', 'final attribute')
    document.body.appendChild(parent)
    markSerializedAncestors(textNode, 160)
    const mutations = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS + 2 },
      (_, index) =>
        index % 2
          ? {
              type: 'characterData',
              target: textNode,
              oldValue: 'old text ' + index
            }
          : {
              type: 'attributes',
              target: parent,
              attributeName: 'data-final',
              oldValue: 'old attribute ' + index
            }
    )
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback(mutations)
    expect(observer.flush()).toBeTrue()

    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.texts).toEqual([
      { id: getSerializedNodeId(textNode), value: 'final text' }
    ])
    expect(payload.attributes).toEqual([
      {
        id: getSerializedNodeId(parent),
        attributes: { 'data-final': 'final attribute' }
      }
    ])
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    observer.stop()
    parent.remove()
  })

  it('should keep a medium structural replacement incremental beside a chunked attribute tail', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const removedNode = document.createElement('span')
    parent.appendChild(removedNode)
    document.body.appendChild(parent)
    markSerializedAncestors(removedNode, 170)
    const addedNodes = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES * 2 - 1 },
      () => document.createElement('i')
    )
    parent.replaceChildren(...addedNodes)
    const attributeMutations = Array.from(
      { length: MAX_PENDING_MUTATION_RECORDS + 1 },
      (_, index) => {
        const attributeName = 'data-after-replacement-' + index
        parent.setAttribute(attributeName, String(index))
        return {
          type: 'attributes',
          target: parent,
          attributeName,
          oldValue: null
        }
      }
    )
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes,
        removedNodes: [removedNode]
      },
      ...attributeMutations
    ])
    expect(observer.flush()).toBeTrue()

    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.adds.length).toBe(addedNodes.length)
    expect(payload.removes).toEqual([
      {
        parentId: getSerializedNodeId(parent),
        id: getSerializedNodeId(removedNode)
      }
    ])
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    observer.stop()
    parent.remove()
  })

  it('should recover before chunking an oversized structural replacement', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const removedNode = document.createElement('span')
    parent.appendChild(removedNode)
    document.body.appendChild(parent)
    markSerializedAncestors(removedNode, 171)
    const addedNodes = Array.from(
      { length: MAX_PENDING_MUTATION_NODES },
      () => document.createElement('i')
    )
    parent.replaceChildren(...addedNodes)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes,
        removedNodes: [removedNode]
      }
    ])
    expect(observer.flush()).toBeFalse()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'mutation_normalization_budget',
      mutationRecordCount: 1
    })

    observer.stop()
    parent.remove()
  })

  it('should drain pending roots at the admission limit without dropping the tail', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 900160)
    const roots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS + 1 },
      () => {
        const root = document.createElement('section')
        parent.appendChild(root)
        return root
      }
    )
    parent.setAttribute('data-mixed-batch', 'kept')
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: roots,
        removedNodes: []
      },
      {
        type: 'attributes',
        target: parent,
        attributeName: 'data-mixed-batch',
        oldValue: null
      }
    ])
    observer.flush()

    const firstBatchPayloads = mutationCallback.calls
      .allArgs()
      .map((args) => args[0])
    expect(
      firstBatchPayloads.reduce(
        (count, payload) => count + payload.adds.length,
        0
      )
    ).toBe(MAX_PENDING_MUTATION_ROOT_TASKS + 1)
    expect(
      firstBatchPayloads.some((payload) =>
        payload.attributes.some(
          (attribute) =>
            attribute.attributes['data-mixed-batch'] === 'kept'
        )
      )
    ).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    const callCountAfterAdmissionDrain = mutationCallback.calls.count()
    const laterRoot = document.createElement('section')
    laterRoot.setAttribute('data-after-admission-drop', 'true')
    parent.appendChild(laterRoot)
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [laterRoot],
        removedNodes: []
      }
    ])
    observer.flush()

    expect(mutationCallback.calls.count()).toBeGreaterThan(
      callCountAfterAdmissionDrain
    )
    expect(
      mutationCallback.calls
        .allArgs()
        .slice(callCountAfterAdmissionDrain)
        .some((args) =>
          args[0].adds.some(
            (add) =>
              add.node.attributes['data-after-admission-drop'] === 'true'
          )
        )
    ).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    observer.stop()
    parent.remove()
  })

  it('should defer and emit more than twice the active pure-add root limit in order', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 900161)
    const rootCount = MAX_PENDING_MUTATION_ROOT_TASKS * 2 + 8
    const roots = Array.from({ length: rootCount }, (_, index) => {
      const root = document.createElement('section')
      root.setAttribute('data-root-index', String(index))
      parent.appendChild(root)
      return root
    })
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: roots,
        removedNodes: []
      }
    ])

    let flushResult
    do {
      flushResult = observer.flush()
    } while (flushResult === 'pending')
    expect(flushResult).toBeTrue()
    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const emittedRootIndexes = emittedAdds.map((add) =>
      Number(add.node.attributes['data-root-index'])
    )
    expect(emittedRootIndexes).toEqual(
      Array.from({ length: rootCount }, (_, index) => rootCount - index - 1)
    )

    // Replay each add using its recorded nextId. Tail-first chunks preserve
    // the global reverse-sibling dependency order, so every non-null nextId
    // must already exist when the add is applied.
    const replayedRootIndexes = []
    const replayedRootIndexById = new Map()
    emittedAdds.forEach((add) => {
      const rootIndex = Number(
        add.node.attributes['data-root-index']
      )
      const nextRootIndex = replayedRootIndexById.get(add.nextId)
      if (nextRootIndex === undefined) {
        expect(add.nextId).toBeNull()
        replayedRootIndexes.push(rootIndex)
      } else {
        replayedRootIndexes.splice(
          replayedRootIndexes.indexOf(nextRootIndex),
          0,
          rootIndex
        )
      }
      replayedRootIndexById.set(add.node.id, rootIndex)
    })
    expect(replayedRootIndexes).toEqual(
      Array.from({ length: rootCount }, (_, index) => index)
    )
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    observer.stop()
    parent.remove()
  })

  it('should report a local drop at the deferred root admission watermark without overflowing', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 900162)
    const rootCount =
      MAX_PENDING_MUTATION_ROOT_TASKS +
      MAX_DEFERRED_MUTATION_ROOT_TASKS +
      1
    const roots = Array.from({ length: rootCount }, (_, index) => {
      const root = document.createElement('section')
      root.setAttribute('data-root-index', String(index))
      return root
    })
    const fragment = document.createDocumentFragment()
    roots.forEach((root) => fragment.appendChild(root))
    parent.appendChild(fragment)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationPerfCallback = jasmine.createSpy(
      'mutationPerfCallback'
    )
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      mutationPerfCallback,
      mutationOverflowCallback
    )
    const normalizationState = { exhausted: false }
    const addRootTask = (root) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        normalizationState
      })

    try {
      roots
        .slice()
        .reverse()
        .forEach((root) => expect(addRootTask(root)).toBeTrue())

      const locallyDroppedRoot = roots[0]
      expect(
        controller.findPendingRootTask(locallyDroppedRoot)
      ).toBeUndefined()
      expect(mutationPerfCallback).toHaveBeenCalledOnceWith({
        mutationLocalDropCount: 1,
        mutationLocalDropReason: 'mutation_root_admission_watermark'
      })
      expect(mutationOverflowCallback).not.toHaveBeenCalled()

      let flushResult
      do {
        flushResult = controller.flush()
      } while (flushResult === 'pending')
      expect(flushResult).toBeTrue()

      const callbackCountAfterDrain = mutationCallback.calls.count()
      const laterRoot = document.createElement('section')
      laterRoot.setAttribute('data-after-local-drop', 'true')
      parent.appendChild(laterRoot)
      expect(addRootTask(laterRoot)).toBeTrue()
      expect(controller.flush()).toBeTrue()
      expect(mutationCallback.calls.count()).toBeGreaterThan(
        callbackCountAfterDrain
      )
      expect(
        mutationCallback.calls
          .allArgs()
          .slice(callbackCountAfterDrain)
          .some((args) =>
            args[0].adds.some(
              (add) =>
                add.node.attributes['data-after-local-drop'] === 'true'
            )
          )
      ).toBeTrue()
      expect(mutationOverflowCallback).not.toHaveBeenCalled()
    } finally {
      controller.stop()
      parent.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should report a local drop at the deferred retained byte watermark without overflowing', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 900163)
    const retainedRoot = document.createElement('section')
    const locallyDroppedRoot = document.createElement('article')
    parent.appendChild(retainedRoot)
    parent.appendChild(locallyDroppedRoot)
    const mutationPerfCallback = jasmine.createSpy(
      'mutationPerfCallback'
    )
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      configuration,
      shadowRootsController,
      mutationPerfCallback,
      mutationOverflowCallback
    )

    try {
      const mutationGroup = controller.createMutationGroup()
      expect(
        controller.addPendingRootTask(retainedRoot, {
          parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
          serializationContext: {
            status: SerializationContextStatus.MUTATION,
            shadowRootsController
          },
          configuration,
          mutationGroup
        })
      ).toBeTrue()
      const retainedTask = controller.findPendingRootTask(retainedRoot)
      const attributeOverhead = 24 + 'fill'.length * 2
      const targetPayloadApproxBytes =
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES -
        mutationGroup.approxBytes -
        retainedTask.accountedApproxBytes -
        1
      const retainedValueLength = Math.floor(
        (targetPayloadApproxBytes - attributeOverhead) / 2
      )
      controller.completeMutationGroup(mutationGroup, {
        adds: [],
        removes: [],
        texts: [],
        attributes: [
          {
            id: 900163,
            attributes: { fill: 'x'.repeat(retainedValueLength) }
          }
        ]
      })

      expect(
        controller.addPendingRootTask(locallyDroppedRoot, {
          parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
          serializationContext: {
            status: SerializationContextStatus.MUTATION,
            shadowRootsController
          },
          configuration,
          normalizationState: { exhausted: false }
        })
      ).toBeTrue()
      expect(
        controller.findPendingRootTask(locallyDroppedRoot)
      ).toBeUndefined()
      expect(mutationPerfCallback).toHaveBeenCalledOnceWith({
        mutationLocalDropCount: 1,
        mutationLocalDropReason:
          'mutation_root_retained_bytes_watermark'
      })
      expect(mutationOverflowCallback).not.toHaveBeenCalled()
    } finally {
      controller.stop()
      parent.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should report a local drop when a deferred shared reservation is rejected without failing the budget', () => {
    jasmine.clock().install()
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 900164)
    const activeRoots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS },
      () => document.createElement('section')
    )
    const locallyDroppedRoot = document.createElement('article')
    const laterDeferredRoot = document.createElement('aside')
    const fragment = document.createDocumentFragment()
    fragment.appendChild(locallyDroppedRoot)
    fragment.appendChild(laterDeferredRoot)
    activeRoots.forEach((root) => fragment.appendChild(root))
    parent.appendChild(fragment)
    const mutationPerfCallback = jasmine.createSpy(
      'mutationPerfCallback'
    )
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const failOnce = jasmine.createSpy('failOnce')
    let rejectRetainedUpdate = false
    const releaseRetainedReservation = jasmine.createSpy(
      'releaseRetainedReservation'
    )
    releaseRetainedReservation.update = jasmine
      .createSpy('updateRetainedReservation')
      .and.callFake(() => !rejectRetainedUpdate)
    const mutationResourceBudget = {
      reserve: jasmine
        .createSpy('reserve')
        .and.returnValue(releaseRetainedReservation),
      failOnce
    }
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      configuration,
      shadowRootsController,
      mutationPerfCallback,
      mutationOverflowCallback,
      undefined,
      undefined,
      mutationResourceBudget
    )
    const normalizationState = { exhausted: false }
    const addRootTask = (root) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        normalizationState
      })

    try {
      activeRoots
        .slice()
        .reverse()
        .forEach((root) => expect(addRootTask(root)).toBeTrue())
      rejectRetainedUpdate = true
      expect(addRootTask(locallyDroppedRoot)).toBeTrue()
      expect(
        controller.findPendingRootTask(locallyDroppedRoot)
      ).toBeUndefined()
      expect(mutationPerfCallback).toHaveBeenCalledOnceWith({
        mutationLocalDropCount: 1,
        mutationLocalDropReason: 'aggregate_retained_mutation_watermark'
      })
      expect(mutationOverflowCallback).not.toHaveBeenCalled()
      expect(failOnce).not.toHaveBeenCalled()

      rejectRetainedUpdate = false
      expect(addRootTask(laterDeferredRoot)).toBeTrue()
      expect(
        controller.findPendingRootTask(laterDeferredRoot)
      ).toBeDefined()
      expect(mutationOverflowCallback).not.toHaveBeenCalled()
      expect(failOnce).not.toHaveBeenCalled()
    } finally {
      controller.stop()
      parent.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should emit a published cross-observer move before earlier pure-add siblings reference it', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const sourceParent = document.createElement('div')
    const destinationParent = document.createElement('div')
    document.body.appendChild(sourceParent)
    document.body.appendChild(destinationParent)
    markSerializedAncestors(sourceParent, 900170)
    markSerializedAncestors(destinationParent, 900180)
    const movedSibling = document.createElement('aside')
    sourceParent.appendChild(movedSibling)
    setSerializedNodeId(movedSibling, 900190)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      destinationParent,
      undefined,
      mutationOverflowCallback
    )
    const newSiblings = Array.from(
      { length: MUTATION_CHUNK_MAX_NODES - 1 },
      (_, index) => {
        const sibling = document.createElement('section')
        sibling.setAttribute('data-sibling-index', String(index))
        destinationParent.appendChild(sibling)
        return sibling
      }
    )
    destinationParent.appendChild(movedSibling)

    // Only the destination observer callback is delivered here. The removal
    // belongs to the independently flushed source observer.
    observedCallback([
      {
        type: 'childList',
        target: destinationParent,
        addedNodes: newSiblings.concat(movedSibling),
        removedNodes: []
      }
    ])

    let flushResult
    do {
      flushResult = observer.flush()
    } while (flushResult === 'pending')

    expect(flushResult).toBeTrue()
    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    expect(emittedAdds[0].node.id).toBe(900190)
    const precedingSiblingAdd = emittedAdds.find(
      (add) =>
        add.node.attributes['data-sibling-index'] ===
        String(newSiblings.length - 1)
    )
    expect(precedingSiblingAdd.nextId).toBe(900190)
    expect(emittedAdds.indexOf(precedingSiblingAdd)).toBeGreaterThan(
      emittedAdds.findIndex((add) => add.node.id === 900190)
    )
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    observer.stop()
    sourceParent.remove()
    destinationParent.remove()
  })

  it('should admit a published move after draining the root watermark', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 162)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (root, requiresBaselineOnDrop) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop
      })

    for (
      let index = 0;
      index < MAX_PENDING_MUTATION_ROOT_TASKS;
      index += 1
    ) {
      const root = document.createElement('div')
      parent.appendChild(root)
      expect(addRootTask(root, false)).toBeTrue()
    }
    const movedRoot = document.createElement('section')
    setSerializedNodeId(movedRoot, 900003)
    parent.appendChild(movedRoot)

    expect(addRootTask(movedRoot, true)).toBeTrue()
    expect(controller.flush()).toBeTrue()
    expect(
      mutationCallback.calls
        .allArgs()
        .some((args) =>
          args[0].adds.some((add) => add.node.id === 900003)
        )
    ).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    controller.stop()
    parent.remove()
  })

  it('should drain an older deferred root before admitting non-deferred tasks', () => {
    let currentTime = 0
    spyOn(performance, 'now').and.callFake(() => currentTime)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 163)
    const initialRoots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS },
      () => {
        const root = document.createElement('div')
        parent.appendChild(root)
        return root
      }
    )
    const deferredRoot = document.createElement('section')
    parent.appendChild(deferredRoot)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (root, requiresBaselineOnDrop) =>
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop
      })

    initialRoots.forEach((root) =>
      expect(addRootTask(root, false)).toBeTrue()
    )
    const initialTasks = initialRoots.map((root) =>
      controller.findPendingRootTask(root)
    )
    spyOn(initialTasks[0].serializerTask, 'advance').and.callFake(() => {
      currentTime = MUTATION_NORMALIZATION_MAX_DURATION_MS
      return false
    })
    expect(addRootTask(deferredRoot, false)).toBeTrue()
    expect(controller.findPendingRootTask(deferredRoot).isDeferred).toBeTrue()

    initialRoots.forEach((root, index) => {
      root.remove()
      expect(
        controller.handlePendingRootRemoval(initialTasks[index], root)
      ).toBeTrue()
    })
    currentTime = 0

    const laterRoots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS },
      () => {
        const root = document.createElement('article')
        parent.appendChild(root)
        return root
      }
    )
    laterRoots.forEach((root) =>
      expect(addRootTask(root, true)).toBeTrue()
    )
    expect(controller.flush()).toBeTrue()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    expect(emittedAdds.length).toBe(laterRoots.length + 1)
    expect(emittedAdds[0].node.tagName).toBe('section')
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should recover once when an active continuation keeps an older deferred root blocked', () => {
    jasmine.clock().install()
    let currentTime = 0
    spyOn(performance, 'now').and.callFake(() => currentTime)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1630)
    const initialRoots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS },
      () => {
        const root = document.createElement('div')
        parent.appendChild(root)
        return root
      }
    )
    const deferredRoot = document.createElement('section')
    const publishedRoot = document.createElement('article')
    parent.appendChild(deferredRoot)
    parent.appendChild(publishedRoot)
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (root, requiresBaselineOnDrop) =>
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop
      })

    try {
      initialRoots.forEach((root) =>
        expect(addRootTask(root, false)).toBeTrue()
      )
      const firstTask = controller.findPendingRootTask(initialRoots[0])
      const blockedAdvance = spyOn(
        firstTask.serializerTask,
        'advance'
      ).and.callFake(() => {
        currentTime += MUTATION_NORMALIZATION_MAX_DURATION_MS
        return false
      })

      expect(addRootTask(deferredRoot, false)).toBeTrue()
      expect(
        controller.findPendingRootTask(deferredRoot).isDeferred
      ).toBeTrue()

      expect(addRootTask(publishedRoot, true)).toBeFalse()
      expect(blockedAdvance).toHaveBeenCalledTimes(2)
      expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
        reason: 'mutation_root_admission_watermark'
      })
      expect(controller.findPendingRootTask(deferredRoot)).toBeUndefined()
      expect(controller.findPendingRootTask(publishedRoot)).toBeUndefined()

      jasmine.clock().tick(0)
      expect(mutationOverflowCallback).toHaveBeenCalledTimes(1)
    } finally {
      controller.stop()
      parent.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should abort admission when a synchronous recovery resets the controller', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 164)
    const roots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS },
      () => {
        const root = document.createElement('div')
        parent.appendChild(root)
        return root
      }
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    let controller
    const mutationOverflowCallback = jasmine
      .createSpy('mutationOverflowCallback')
      .and.callFake(() => controller.reset())
    controller = createMutationTasksController(
      jasmine.createSpy('mutationCallback'),
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (root) =>
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    roots.forEach((root) => expect(addRootTask(root)).toBeTrue())
    const firstTask = controller.findPendingRootTask(roots[0])
    spyOn(firstTask.serializerTask, 'advance').and.callFake(() => {
      firstTask.serializerTask.isMaxApproxBytesReached = true
      firstTask.serializerTask.approxBytes = 200001
      return false
    })

    const rejectedRoot = document.createElement('article')
    parent.appendChild(rejectedRoot)
    expect(addRootTask(rejectedRoot)).toBeFalse()
    expect(controller.findPendingRootTask(rejectedRoot)).toBeUndefined()
    expect(controller.getOverflowCount()).toBe(1)
    expect(mutationOverflowCallback).toHaveBeenCalledTimes(1)

    controller.stop()
    parent.remove()
  })

  it('should resolve nextId at emission after a root-admission drain', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 164)
    const admittedRoots = Array.from(
      { length: MAX_PENDING_MUTATION_ROOT_TASKS },
      () => {
        const root = document.createElement('section')
        parent.appendChild(root)
        return root
      }
    )
    const droppedRoot = document.createElement('article')
    setSerializedNodeId(droppedRoot, 900004)
    parent.appendChild(droppedRoot)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )
    const serializedNodeIds = new Set()
    const addRootTask = (root) =>
      controller.addPendingRootTask(root, {
        serializedNodeIds,
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    admittedRoots.forEach((root) => expect(addRootTask(root)).toBeTrue())
    const lastAdmittedTask = controller.findPendingRootTask(
      admittedRoots[admittedRoots.length - 1]
    )
    expect(lastAdmittedTask.nextId).toBeNull()

    expect(addRootTask(droppedRoot)).toBeTrue()
    expect(controller.findPendingRootTask(droppedRoot)).toBeDefined()
    expect(lastAdmittedTask.nextId).toBe(900004)
    expect(controller.flush()).toBeTrue()

    const previousRoot = document.createElement('aside')
    parent.insertBefore(previousRoot, droppedRoot)
    expect(addRootTask(previousRoot)).toBeTrue()
    expect(controller.findPendingRootTask(previousRoot).nextId).toBeNull()
    expect(controller.flush()).toBeTrue()
    const previousAdd = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
      .find((add) => add.node.tagName === 'aside')
    expect(previousAdd.nextId).toBe(900004)

    controller.stop()
    parent.remove()
  })

  it('should recover an async-overflowing new root without publishing its queued sibling', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 165)

    const keptRoot = document.createElement('article')
    keptRoot.setAttribute('data-root', 'kept')
    const droppedRoot = document.createElement('section')
    droppedRoot.setAttribute('data-root', 'dropped')
    droppedRoot.appendChild(document.createElement('span'))
    parent.appendChild(keptRoot)
    parent.appendChild(droppedRoot)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const serializedNodeIds = new Set()
    const addRootTask = (root) =>
      controller.addPendingRootTask(root, {
        serializedNodeIds,
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    // Sibling anchors are intentionally deferred to the bounded emission pass.
    expect(addRootTask(droppedRoot)).toBeTrue()
    const droppedTask = controller.findPendingRootTask(droppedRoot)
    expect(addRootTask(keptRoot)).toBeTrue()
    const keptTask = controller.findPendingRootTask(keptRoot)
    expect(keptTask.nextId).toBeNull()

    spyOn(droppedTask.serializerTask, 'advance').and.callFake(() => {
      droppedTask.serializerTask.isMaxApproxBytesReached = true
      droppedTask.serializerTask.approxBytes = 200001
      return false
    })

    expect(controller.flush()).toBeFalse()

    expect(droppedTask.publicationToken.$rCanceled).toBeTrue()
    expect(keptTask.publicationToken.$rCanceled).toBeTrue()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'unpublished_add_serialization_watermark'
    })
    expect(mutationCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should request baseline recovery when a published move exceeds the async serialization watermark', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const firstParent = document.createElement('div')
    const secondParent = document.createElement('div')
    document.body.appendChild(firstParent)
    document.body.appendChild(secondParent)
    markSerializedAncestors(firstParent, 166)
    setSerializedNodeId(secondParent, 176)

    const movedRoot = document.createElement('section')
    movedRoot.appendChild(document.createElement('span'))
    firstParent.appendChild(movedRoot)
    markSerializedAncestors(movedRoot, 186)
    secondParent.appendChild(movedRoot)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    expect(
      controller.addPendingRootTask(movedRoot, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop: true
      })
    ).toBeTrue()
    const movedTask = controller.findPendingRootTask(movedRoot)
    const publicationToken = movedTask.publicationToken
    spyOn(movedTask.serializerTask, 'advance').and.callFake(() => {
      movedTask.serializerTask.isMaxApproxBytesReached = true
      movedTask.serializerTask.approxBytes = 200001
      return false
    })

    expect(controller.flush()).toBeFalse()

    expect(publicationToken.$rCanceled).toBeTrue()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_serialization_watermark'
    })

    controller.stop()
    firstParent.remove()
    secondParent.remove()
  })

  it('should serialize roots in order behind an unfinished sequence', () => {
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now)

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 170)

    const attributeLength = 55000
    const shallowRootCount =
      Math.ceil(
        MAX_PENDING_MUTATION_ROOT_APPROX_BYTES /
          (attributeLength * 2)
      ) + 3
    const blockingRoot = document.createElement('section')
    blockingRoot.appendChild(document.createElement('div'))
    parent.appendChild(blockingRoot)

    const shallowRoots = []
    for (let index = 0; index < shallowRootCount; index += 1) {
      const root = document.createElement('article')
      const child = document.createElement('span')
      child.setAttribute('title', 'x'.repeat(attributeLength))
      root.appendChild(child)
      parent.appendChild(root)
      shallowRoots.push(root)
    }

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    function addRootTask(root) {
      return controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    }
    expect(addRootTask(blockingRoot)).toBeTrue()
    const blockingTask = controller.findPendingRootTask(blockingRoot)
    spyOn(blockingTask.serializerTask, 'advance').and.callFake(
      (deadline) => {
        now = deadline
        return false
      }
    )
    shallowRoots.forEach((root) => {
      expect(addRootTask(root)).toBeTrue()
    })

    // Keep sequence zero as the single continuation instead of completing and
    // retaining every later sibling behind it.
    expect(controller.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(controller.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    const retainedShallowRootCount = shallowRoots.filter((root) =>
      controller.findPendingRootTask(root)
    ).length
    expect(retainedShallowRootCount).toBe(shallowRootCount)

    blockingRoot.remove()
    expect(
      controller.handlePendingRootRemoval(blockingTask, blockingRoot)
    ).toBeTrue()
    for (
      let flushIndex = 0;
      flushIndex < shallowRootCount;
      flushIndex += 1
    ) {
      expect(controller.flush()).toBeTrue()
    }

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .map((args) => args[0])
      .flatMap((payload) => payload.adds)
    expect(emittedAdds.length).toBe(shallowRootCount)
    const emittedNodeIds = new Set(
      emittedAdds.map((add) => add.node.id)
    )
    emittedAdds.forEach((add) => {
      expect(
        add.nextId === null || emittedNodeIds.has(add.nextId)
      ).toBeTrue()
    })
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    controller.stop()
    parent.remove()
  })

  it('should preserve a large root removal by using bounded shadow registry cleanup', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 180)

    const removedRoot = document.createElement('div')
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    removedRoot.appendChild(host)
    const children = document.createDocumentFragment()
    for (
      let index = 0;
      index < MAX_REMOVED_SUBTREE_TRAVERSAL_NODES + 1000;
      index += 1
    ) {
      children.appendChild(document.createElement('span'))
    }
    removedRoot.appendChild(children)
    parent.appendChild(removedRoot)
    setSerializedNodeId(removedRoot, 181)
    parent.removeChild(removedRoot)

    const removeShadowRoot = jasmine.createSpy('removeShadowRoot')
    const cleanupDisconnectedShadowRoots = jasmine
      .createSpy('cleanupDisconnectedShadowRoots')
      .and.callFake(() => removeShadowRoot(shadowRoot))
    const resetShadowRoots = jasmine.createSpy('resetShadowRoots')
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      {
        cleanupDisconnectedShadowRoots,
        removeShadowRoot,
        reset: resetShadowRoots
      },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [],
        removedNodes: [removedRoot]
      }
    ])
    observer.flush()

    expect(cleanupDisconnectedShadowRoots).toHaveBeenCalledTimes(1)
    expect(removeShadowRoot).toHaveBeenCalledOnceWith(shadowRoot)
    expect(resetShadowRoots).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    expect(mutationCallback.calls.mostRecent().args[0].removes).toEqual([
      {
        parentId: 180,
        id: 181
      }
    ])
    observer.stop()
    parent.remove()
  })

  it('should recover one pending new root refreshed past its bounded retry limit', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 185)
    const root = document.createElement('section')
    root.appendChild(document.createElement('span'))
    parent.appendChild(root)

    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    expect(
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    const task = controller.findPendingRootTask(root)

    for (
      let refresh = 0;
      refresh < MAX_MUTATION_ROOT_TASK_REFRESH_COUNT;
      refresh += 1
    ) {
      root.setAttribute('data-refresh', String(refresh))
      expect(controller.refreshPendingRootTask(task)).toBeTrue()
    }
    expect(controller.refreshPendingRootTask(task)).toBeFalse()

    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'unpublished_add_serialization_watermark'
    })
    expect(controller.findPendingRootTask(root)).toBeUndefined()
    expect(mutationCallback).not.toHaveBeenCalled()
    controller.stop()
    parent.remove()
  })

  it('should drop unfinished serialization instead of draining it without a deadline', () => {
    let normalizationComplete = false
    let serializationNow = 0
    spyOn(performance, 'now').and.callFake(() => {
      if (!normalizationComplete) {
        return 0
      }
      serializationNow += 2
      return serializationNow
    })
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 175)
    const child = document.createElement('div')
    let current = child
    for (let depth = 0; depth < 100; depth += 1) {
      const nested = document.createElement('div')
      current.appendChild(nested)
      current = nested
    }
    parent.appendChild(child)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      () => {
        normalizationComplete = true
      },
      mutationOverflowCallback
    )
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    expect(observer.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledWith({
      reason: 'serialization_budget'
    })
  })

  it('should request baseline recovery for a new root above the mutation node watermark', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined
    spyOn(performance, 'now').and.returnValue(0)

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 190)
    const child = document.createElement('div')
    const descendants = document.createDocumentFragment()
    for (let index = 0; index < 5001; index += 1) {
      descendants.appendChild(document.createTextNode('x'))
    }
    child.appendChild(descendants)
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])
    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'unpublished_add_serialization_watermark'
    })

    observer.stop()
    parent.remove()
  })

  it('should request baseline recovery when one new root exceeds the aggregate byte watermark', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1900)
    const child = document.createElement('section')
    for (let index = 0; index < 4; index += 1) {
      const textContainer = document.createElement('span')
      textContainer.textContent = 'x'.repeat(30000)
      child.appendChild(textContainer)
    }
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    expect(observer.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'unpublished_add_serialization_watermark'
    })

    observer.stop()
    parent.remove()
  })

  it('should stream a large pure-add batch without retaining one oversized atomic group', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1901)
    const addedRoots = []
    for (let index = 0; index < 24; index += 1) {
      const root = document.createElement('section')
      root.textContent = String(index) + 'x'.repeat(90000)
      parent.appendChild(root)
      addedRoots.push(root)
    }

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const createMutationGroupSpy = spyOn(
      controller,
      'createMutationGroup'
    ).and.callThrough()

    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: addedRoots,
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller,
      undefined,
      undefined,
      { transaction: { $rPureAdd: true }, isLast: true }
    )

    expect(controller.flush()).toBeTrue()
    expect(createMutationGroupSpy).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(
      mutationCallback.calls
        .allArgs()
        .reduce((count, args) => count + args[0].adds.length, 0)
    ).toBe(addedRoots.length)

    controller.stop()
    parent.remove()
  })

  it('should recover a cross-shadow-root move when its oversized destination wrapper is dropped', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const sourceHost = document.createElement('div')
    const destinationHost = document.createElement('div')
    document.body.appendChild(sourceHost)
    document.body.appendChild(destinationHost)
    markSerializedAncestors(sourceHost, 191)
    markSerializedAncestors(destinationHost, 201)
    const sourceRoot = sourceHost.attachShadow({ mode: 'open' })
    const destinationRoot = destinationHost.attachShadow({
      mode: 'open'
    })
    setSerializedNodeId(sourceRoot, 211)
    setSerializedNodeId(destinationRoot, 212)

    const publishedInput = document.createElement('input')
    sourceRoot.appendChild(publishedInput)
    setSerializedNodeId(publishedInput, 213)
    const oversizedWrapper = document.createElement('section')
    const descendants = document.createDocumentFragment()
    for (let index = 0; index < 5001; index += 1) {
      descendants.appendChild(document.createElement('i'))
    }
    oversizedWrapper.appendChild(descendants)
    // Put the published descendant past the serialization watermark. The
    // controller must not rely on reaching the descendant serializer callback
    // before deciding whether the wrapper can be dropped locally.
    oversizedWrapper.appendChild(publishedInput)
    destinationRoot.appendChild(oversizedWrapper)

    const stagedMutationPayloads = []
    const stageMutationPayload = (payload) => {
      stagedMutationPayloads.push(payload)
    }
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const isNodePublished = (node) => node === publishedInput
    const stageMutationNodePublication = (
      node,
      _parentNode,
      publicationToken
    ) => {
      if (isNodePublished(node)) {
        publicationToken.$rRequiresBaselineOnDrop = true
      }
    }
    const sourceController = createMutationTasksController(
      stageMutationPayload,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const destinationController = createMutationTasksController(
      stageMutationPayload,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback,
      stageMutationNodePublication
    )

    processMutations(
      [
        {
          type: 'childList',
          target: sourceRoot,
          addedNodes: [],
          removedNodes: [publishedInput]
        }
      ],
      stageMutationPayload,
      configuration,
      shadowRootsController,
      sourceController,
      undefined,
      isNodePublished
    )
    processMutations(
      [
        {
          type: 'childList',
          target: destinationRoot,
          addedNodes: [oversizedWrapper],
          removedNodes: []
        }
      ],
      stageMutationPayload,
      configuration,
      shadowRootsController,
      destinationController,
      undefined,
      isNodePublished
    )
    destinationController.flush()

    // A shadow-root flush transaction discards its staged mutations when
    // recovery is requested. Without recovery, the source removal would be
    // dispatched alone after the destination add is dropped locally.
    const dispatchedMutationPayloads =
      mutationOverflowCallback.calls.any()
        ? []
        : stagedMutationPayloads
    const hasRemoveOnlyPayload = dispatchedMutationPayloads.some(
      (payload) =>
        payload.removes.length > 0 && payload.adds.length === 0
    )

    sourceController.stop()
    destinationController.stop()
    sourceHost.remove()
    destinationHost.remove()

    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_serialization_watermark'
    })
    expect(hasRemoveOnlyPayload).toBeFalse()
  })

  it('should recover when the destination wrapper is dropped before the source removal is processed', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const sourceHost = document.createElement('div')
    const destinationHost = document.createElement('div')
    document.body.appendChild(sourceHost)
    document.body.appendChild(destinationHost)
    markSerializedAncestors(sourceHost, 215)
    markSerializedAncestors(destinationHost, 225)
    const sourceRoot = sourceHost.attachShadow({ mode: 'open' })
    const destinationRoot = destinationHost.attachShadow({ mode: 'open' })
    setSerializedNodeId(sourceRoot, 235)
    setSerializedNodeId(destinationRoot, 236)
    const publishedInput = document.createElement('input')
    sourceRoot.appendChild(publishedInput)
    setSerializedNodeId(publishedInput, 237)
    const wrapper = document.createElement('section')
    wrapper.appendChild(publishedInput)
    destinationRoot.appendChild(wrapper)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const destinationController = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const isNodePublished = (node) => node === publishedInput

    processMutations(
      [
        {
          type: 'childList',
          target: destinationRoot,
          addedNodes: [wrapper],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      destinationController,
      undefined,
      isNodePublished
    )
    const wrapperTask = destinationController.findPendingRootTask(wrapper)
    spyOn(wrapperTask.serializerTask, 'advance').and.callFake(() => {
      wrapperTask.serializerTask.isMaxNodeCountReached = true
      return false
    })
    expect(destinationController.flush()).toBeFalse()

    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'unpublished_add_serialization_watermark'
    })
    expect(mutationCallback).not.toHaveBeenCalled()
    destinationController.stop()
    sourceHost.remove()
    destinationHost.remove()
  })

  it('should recover an oversized add atomically with a sibling text replacement', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const status = document.createElement('span')
    const previousTextNode = document.createTextNode('before')
    status.appendChild(previousTextNode)
    parent.appendChild(status)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 214)

    const nextTextNode = document.createTextNode('after')
    status.replaceChild(nextTextNode, previousTextNode)
    const oversizedRoot = document.createElement('section')
    const descendants = document.createDocumentFragment()
    for (let index = 0; index < 5001; index += 1) {
      descendants.appendChild(document.createElement('i'))
    }
    oversizedRoot.appendChild(descendants)
    parent.appendChild(oversizedRoot)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    processMutations(
      [
        {
          type: 'childList',
          target: status,
          addedNodes: [nextTextNode],
          removedNodes: [previousTextNode]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [oversizedRoot],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    controller.flush()

    controller.stop()
    parent.remove()

    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'unpublished_add_serialization_watermark'
    })
    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should atomically emit a replacement after truncating its oversized text', () => {
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 195)
    const nextTextNode = document.createTextNode(
      'x'.repeat(SERIALIZATION_MAX_NODE_SOURCE_LENGTH + 1)
    )
    parent.replaceChild(nextTextNode, previousTextNode)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [nextTextNode],
        removedNodes: [previousTextNode]
      }
    ])
    observer.flush()

    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.removes.length).toBe(1)
    expect(payload.adds.length).toBe(1)
    expect(payload.adds[0].node.textContent.length).toBe(
      MAX_MUTATION_SERIALIZED_VALUE_CHARACTERS
    )
    expect(payload.adds[0].node.textContent.endsWith('…')).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    observer.stop()
    parent.remove()
  })

  it('should coalesce a pending replacement into the latest node', () => {
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 196)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('intermediate')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    const latestTextNode = document.createTextNode('latest')
    parent.replaceChild(latestTextNode, intermediateTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [latestTextNode],
          removedNodes: [intermediateTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    const finalTextNode = document.createTextNode('final')
    parent.replaceChild(finalTextNode, latestTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [finalTextNode],
          removedNodes: [latestTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    controller.flush()

    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.removes).toEqual([
      jasmine.objectContaining({ id: 196 })
    ])
    expect(payload.adds.length).toBe(1)
    expect(payload.adds[0].node.textContent).toBe('final')

    controller.stop()
    parent.remove()
  })

  it('should coalesce a replacement chain delivered in one batch', () => {
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 197)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('intermediate')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    const latestTextNode = document.createTextNode('latest')
    const finalTextNode = document.createTextNode('final')
    parent.replaceChild(latestTextNode, intermediateTextNode)
    parent.replaceChild(finalTextNode, latestTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [latestTextNode],
          removedNodes: [intermediateTextNode]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [finalTextNode],
          removedNodes: [latestTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    expect(controller.flush()).toBeTrue()

    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.removes).toEqual([
      jasmine.objectContaining({ id: 197 })
    ])
    expect(payload.adds.length).toBe(1)
    expect(payload.adds[0].node.textContent).toBe('final')

    controller.stop()
    parent.remove()
  })

  it('should coalesce a published text replacement chain across normalization chunks', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('step=0')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 1980)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )
    const mutations = []
    let replacedTextNode = previousTextNode
    const replacementCount = MAX_PENDING_MUTATION_RECORDS + 32
    for (let index = 1; index <= replacementCount; index += 1) {
      const replacementTextNode = document.createTextNode(
        'step=' + index
      )
      parent.replaceChild(replacementTextNode, replacedTextNode)
      mutations.push({
        type: 'childList',
        target: parent,
        addedNodes: [replacementTextNode],
        removedNodes: [replacedTextNode],
        previousSibling: null,
        nextSibling: null
      })
      replacedTextNode = replacementTextNode
    }

    observedCallback(mutations)
    let flushResult
    for (let attempt = 0; attempt < 64; attempt += 1) {
      flushResult = observer.flush()
      if (flushResult === true || flushResult === false) {
        break
      }
    }

    expect(flushResult).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.removes).toEqual([
      jasmine.objectContaining({ id: 1980 })
    ])
    expect(payload.adds.length).toBe(1)
    expect(payload.adds[0].node.textContent).toBe(
      'step=' + replacementCount
    )

    observer.stop()
    parent.remove()
  })

  it('should not infer a cross-chunk text replacement without sibling anchors', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('step=0')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 1985)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent,
      undefined,
      mutationOverflowCallback
    )
    const mutations = []
    let replacedTextNode = previousTextNode
    const replacementCount = MAX_PENDING_MUTATION_RECORDS + 1
    for (let index = 1; index <= replacementCount; index += 1) {
      const replacementTextNode = document.createTextNode(
        'missing-anchor-step=' + index
      )
      parent.replaceChild(replacementTextNode, replacedTextNode)
      mutations.push({
        type: 'childList',
        target: parent,
        addedNodes: [replacementTextNode],
        removedNodes: [replacedTextNode]
        // Deliberately omit previousSibling/nextSibling. A synthetic record
        // without native slot evidence must not be treated as null/null.
      })
      replacedTextNode = replacementTextNode
    }

    observedCallback(mutations)

    expect(observer.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_cancelled'
    })

    observer.stop()
    parent.remove()
  })

  it('should coalesce text replacements across queued unchunked callbacks', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const queuePressureParent = document.createElement('div')
    const previousTextNode = document.createTextNode('step=0')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    document.body.appendChild(queuePressureParent)
    markSerializedAncestors(previousTextNode, 1990)
    markSerializedAncestors(queuePressureParent, 1991)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      document.body,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('step=1')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    const fillerNodes = Array.from({ length: 29 }, (_, index) => {
      const node = document.createElement('span')
      node.textContent = 'filler-' + index
      queuePressureParent.appendChild(node)
      return node
    })
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [intermediateTextNode],
        removedNodes: [previousTextNode],
        previousSibling: null,
        nextSibling: null
      },
      {
        type: 'childList',
        target: queuePressureParent,
        addedNodes: fillerNodes,
        removedNodes: []
      }
    ])

    const latestTextNode = document.createTextNode('step=2')
    parent.replaceChild(latestTextNode, intermediateTextNode)
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [latestTextNode],
        removedNodes: [intermediateTextNode],
        previousSibling: null,
        nextSibling: null
      }
    ])

    let flushResult
    for (let attempt = 0; attempt < 16; attempt += 1) {
      flushResult = observer.flush()
      if (flushResult === true || flushResult === false) {
        break
      }
    }

    expect(flushResult).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    const payloads = mutationCallback.calls.allArgs().map((args) => args[0])
    const replacementPayload = payloads.find((payload) =>
      payload.removes.some((remove) => remove.id === 1990)
    )
    expect(replacementPayload).toBeDefined()
    expect(
      replacementPayload.adds.some(
        (add) => add.node.textContent === 'step=2'
      )
    ).toBeTrue()
    expect(
      payloads.reduce(
        (count, payload) =>
          count +
          payload.adds.filter(
            (add) => add.node.textContent === 'step=1'
          ).length,
        0
      )
    ).toBe(0)
    expect(
      payloads.reduce(
        (count, payload) =>
          count +
          payload.adds.filter(
            (add) => add.node.textContent === 'step=2'
          ).length,
        0
      )
    ).toBe(1)

    observer.stop()
    parent.remove()
    queuePressureParent.remove()
  })

  it('should fail closed when a text coalescing marker meets a mismatched edge', () => {
    const mismatches = ['non-1:1', 'cross-parent']
    mismatches.forEach((mismatch) => {
      const parent = document.createElement('div')
      const otherParent = document.createElement('div')
      const finalTextNode = document.createTextNode('final')
      const expectedRemovedNode = document.createTextNode('intermediate')
      parent.appendChild(finalTextNode)
      document.body.appendChild(parent)
      document.body.appendChild(otherParent)
      markSerializedAncestors(parent, mismatch === 'non-1:1' ? 1995 : 2005)
      markSerializedAncestors(
        otherParent,
        mismatch === 'non-1:1' ? 2015 : 2025
      )

      const mutationCallback = jasmine.createSpy(
        mismatch + ' mutationCallback'
      )
      const mutationOverflowCallback = jasmine.createSpy(
        mismatch + ' mutationOverflowCallback'
      )
      const configuration = {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      }
      const shadowRootsController = {
        removeShadowRoot: jasmine.createSpy('removeShadowRoot')
      }
      const controller = createMutationTasksController(
        mutationCallback,
        configuration,
        shadowRootsController,
        undefined,
        mutationOverflowCallback
      )
      const coalescedTextReplacementByRemovedNode = new WeakMap()
      coalescedTextReplacementByRemovedNode.set(expectedRemovedNode, [
        parent,
        finalTextNode
      ])
      const mutation =
        mismatch === 'non-1:1'
          ? {
              type: 'childList',
              target: parent,
              addedNodes: [],
              removedNodes: [expectedRemovedNode],
              previousSibling: null,
              nextSibling: null
            }
          : {
              type: 'childList',
              target: otherParent,
              addedNodes: [document.createTextNode('unexpected')],
              removedNodes: [expectedRemovedNode],
              previousSibling: null,
              nextSibling: null
            }

      processMutations(
        [mutation],
        mutationCallback,
        configuration,
        shadowRootsController,
        controller,
        undefined,
        undefined,
        {
          $rTextReplacementByRemovedNode:
            coalescedTextReplacementByRemovedNode
        }
      )

      expect(controller.flush()).toBeFalse()
      expect(mutationCallback).not.toHaveBeenCalled()
      expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
        reason: 'published_move_cancelled'
      })

      controller.stop()
      parent.remove()
      otherParent.remove()
    })
  })

  it('should not coalesce across a published text node moved from another parent', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const sourceParent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    const movedTextNode = document.createTextNode('published move')
    parent.appendChild(previousTextNode)
    sourceParent.appendChild(movedTextNode)
    document.body.appendChild(parent)
    document.body.appendChild(sourceParent)
    markSerializedAncestors(previousTextNode, 2000)
    markSerializedAncestors(movedTextNode, 2010)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      document.body,
      undefined,
      mutationOverflowCallback
    )

    parent.replaceChild(movedTextNode, previousTextNode)
    const fillerNodes = Array.from({ length: 29 }, (_, index) => {
      const node = document.createElement('span')
      node.textContent = 'published-move-filler-' + index
      parent.appendChild(node)
      return node
    })
    observedCallback([
      {
        type: 'childList',
        target: sourceParent,
        addedNodes: [],
        removedNodes: [movedTextNode]
      },
      {
        type: 'childList',
        target: parent,
        addedNodes: [movedTextNode],
        removedNodes: [previousTextNode],
        previousSibling: null,
        nextSibling: null
      },
      {
        type: 'childList',
        target: parent,
        addedNodes: fillerNodes,
        removedNodes: []
      }
    ])

    const finalTextNode = document.createTextNode('final')
    parent.replaceChild(finalTextNode, movedTextNode)
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [finalTextNode],
        removedNodes: [movedTextNode],
        previousSibling: null,
        nextSibling: null
      }
    ])

    expect(observer.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_cancelled'
    })

    observer.stop()
    parent.remove()
    sourceParent.remove()
  })

  it('should not coalesce through a published text intermediate in one batch', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const sourceParent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    const publishedIntermediate = document.createTextNode(
      'published intermediate'
    )
    parent.appendChild(previousTextNode)
    sourceParent.appendChild(publishedIntermediate)
    document.body.appendChild(parent)
    document.body.appendChild(sourceParent)
    markSerializedAncestors(previousTextNode, 2020)
    markSerializedAncestors(publishedIntermediate, 2030)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    parent.replaceChild(publishedIntermediate, previousTextNode)
    const finalTextNode = document.createTextNode('final')
    parent.replaceChild(finalTextNode, publishedIntermediate)
    processMutations(
      [
        {
          type: 'childList',
          target: sourceParent,
          addedNodes: [],
          removedNodes: [publishedIntermediate]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [publishedIntermediate],
          removedNodes: [previousTextNode],
          previousSibling: null,
          nextSibling: null
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [finalTextNode],
          removedNodes: [publishedIntermediate],
          previousSibling: null,
          nextSibling: null
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    expect(controller.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_cancelled'
    })

    controller.stop()
    parent.remove()
    sourceParent.remove()
  })

  it('should propagate published dependency through a replacement chain', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 198)
    const intermediateTextNode = document.createTextNode('intermediate')
    const finalTextNode = document.createTextNode('final')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    parent.replaceChild(finalTextNode, intermediateTextNode)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [finalTextNode],
          removedNodes: [intermediateTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    const finalTask = controller.findPendingRootTask(finalTextNode)
    expect(finalTask.requiresBaselineOnDrop).toBeTrue()
    spyOn(finalTask.serializerTask, 'advance').and.callFake(() => {
      finalTask.serializerTask.isMaxDepthReached = true
      return false
    })
    expect(controller.flush()).toBeFalse()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_serialization_watermark'
    })

    controller.stop()
    parent.remove()
  })

  it('should recover instead of retargeting to a published moved node', () => {
    const parent = document.createElement('div')
    const sourceParent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    const movedTextNode = document.createTextNode('published')
    parent.appendChild(previousTextNode)
    sourceParent.appendChild(movedTextNode)
    document.body.appendChild(parent)
    document.body.appendChild(sourceParent)
    markSerializedAncestors(previousTextNode, 197)
    markSerializedAncestors(movedTextNode, 198)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('intermediate')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    parent.replaceChild(movedTextNode, intermediateTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: sourceParent,
          addedNodes: [],
          removedNodes: [movedTextNode]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [movedTextNode],
          removedNodes: [intermediateTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_cancelled'
    })

    controller.stop()
    parent.remove()
    sourceParent.remove()
  })

  it('should emit a replacement before its newly inserted sibling', () => {
    const parent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 199)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('intermediate')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    const latestTextNode = document.createTextNode('latest')
    const newSibling = document.createElement('i')
    parent.replaceChild(latestTextNode, intermediateTextNode)
    parent.insertBefore(newSibling, latestTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [latestTextNode],
          removedNodes: [intermediateTextNode]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [newSibling],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    controller.flush()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const replacementAdd = emittedAdds.find(
      (add) => add.node.textContent === 'latest'
    )
    const siblingAdd = emittedAdds.find(
      (add) => add.node.tagName === 'i'
    )
    expect(replacementAdd).toBeDefined()
    expect(siblingAdd).toBeDefined()
    expect(siblingAdd.nextId).toBe(replacementAdd.node.id)
    expect(emittedAdds.indexOf(siblingAdd)).toBeGreaterThan(
      emittedAdds.indexOf(replacementAdd)
    )
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should not overwrite an existing pending replacement owner', () => {
    const parent = document.createElement('div')
    const firstRoot = document.createElement('span')
    const secondRoot = document.createElement('span')
    parent.appendChild(firstRoot)
    parent.appendChild(secondRoot)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 200)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const serializationOptions = {
      serializedNodeIds: new Set(),
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController
      },
      configuration
    }

    expect(
      controller.addPendingRootTask(firstRoot, serializationOptions)
    ).toBeTrue()
    expect(
      controller.addPendingRootTask(secondRoot, serializationOptions)
    ).toBeTrue()
    const firstTask = controller.findPendingRootTask(firstRoot)

    expect(
      controller.$rRetargetPendingRootTask(firstTask, secondRoot)
    ).toBeFalse()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_cancelled'
    })
    expect(mutationCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should coalesce a replacement after an ignored comment anchor', () => {
    const parent = document.createElement('div')
    const commentAnchor = document.createComment('framework-anchor')
    const previousTextNode = document.createTextNode('before')
    parent.appendChild(commentAnchor)
    parent.appendChild(previousTextNode)
    document.body.appendChild(parent)
    markSerializedAncestors(previousTextNode, 201)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('intermediate')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    const latestTextNode = document.createTextNode('latest')
    parent.replaceChild(latestTextNode, intermediateTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [latestTextNode],
          removedNodes: [intermediateTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    controller.flush()

    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    expect(
      mutationCallback.calls.mostRecent().args[0].adds[0].node.textContent
    ).toBe('latest')

    controller.stop()
    parent.remove()
  })

  it('should retarget before a published sibling moves into the same parent', () => {
    const parent = document.createElement('div')
    const sourceParent = document.createElement('div')
    const previousTextNode = document.createTextNode('before')
    const movedSibling = document.createElement('i')
    movedSibling.setAttribute('data-root', 'moved')
    parent.appendChild(previousTextNode)
    sourceParent.appendChild(movedSibling)
    document.body.appendChild(parent)
    document.body.appendChild(sourceParent)
    markSerializedAncestors(previousTextNode, 205)
    markSerializedAncestors(movedSibling, 215)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    const intermediateTextNode = document.createTextNode('intermediate')
    parent.replaceChild(intermediateTextNode, previousTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [intermediateTextNode],
          removedNodes: [previousTextNode]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )

    const latestTextNode = document.createTextNode('latest')
    parent.replaceChild(latestTextNode, intermediateTextNode)
    parent.insertBefore(movedSibling, latestTextNode)
    processMutations(
      [
        {
          type: 'childList',
          target: sourceParent,
          addedNodes: [],
          removedNodes: [movedSibling]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [latestTextNode],
          removedNodes: [intermediateTextNode]
        },
        {
          type: 'childList',
          target: parent,
          addedNodes: [movedSibling],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    controller.flush()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const replacementAdd = emittedAdds.find(
      (add) => add.node.textContent === 'latest'
    )
    const movedAdd = emittedAdds.find(
      (add) =>
        add.node.attributes &&
        add.node.attributes['data-root'] === 'moved'
    )
    expect(replacementAdd).toBeDefined()
    expect(movedAdd.nextId).toBe(replacementAdd.node.id)
    expect(emittedAdds.indexOf(replacementAdd)).toBeLessThan(
      emittedAdds.indexOf(movedAdd)
    )
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
    sourceParent.remove()
  })

  it('should preserve cross-callback sibling order when prepending before a pending root', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 210)
    const pendingRoot = document.createElement('span')
    pendingRoot.setAttribute('data-root', 'pending')
    parent.appendChild(pendingRoot)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )

    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [pendingRoot],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    const prependedRoot = document.createElement('i')
    prependedRoot.setAttribute('data-root', 'prepended')
    parent.insertBefore(prependedRoot, pendingRoot)
    processMutations(
      [
        {
          type: 'childList',
          target: parent,
          addedNodes: [prependedRoot],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    controller.flush()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const pendingAdd = emittedAdds.find(
      (add) => add.node.attributes['data-root'] === 'pending'
    )
    const prependedAdd = emittedAdds.find(
      (add) => add.node.attributes['data-root'] === 'prepended'
    )
    expect(emittedAdds.indexOf(pendingAdd)).toBeLessThan(
      emittedAdds.indexOf(prependedAdd)
    )
    expect(prependedAdd.nextId).toBe(pendingAdd.node.id)

    controller.stop()
    parent.remove()
  })

  it('should invalidate an ignored-sibling cache when a nearer root becomes queued', () => {
    const parent = document.createElement('div')
    const firstRoot = document.createElement('em')
    const laterRoot = document.createElement('i')
    const ignoredAnchor = document.createComment('ignored')
    const nearerRoot = document.createElement('span')
    const publishedAnchor = document.createElement('b')
    parent.appendChild(firstRoot)
    parent.appendChild(laterRoot)
    parent.appendChild(ignoredAnchor)
    parent.appendChild(nearerRoot)
    parent.appendChild(publishedAnchor)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 218)
    setSerializedNodeId(publishedAnchor, 219)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )
    const addRootTask = (node) =>
      controller.addPendingRootTask(node, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    expect(addRootTask(firstRoot)).toBeTrue()
    expect(addRootTask(nearerRoot)).toBeTrue()
    expect(addRootTask(laterRoot)).toBeTrue()
    expect(controller.flush()).toBeTrue()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const nearerAdd = emittedAdds.find(
      (add) => add.node.tagName === 'span'
    )
    const laterAdd = emittedAdds.find((add) => add.node.tagName === 'i')
    expect(laterAdd.nextId).toBe(nearerAdd.node.id)

    controller.stop()
    parent.remove()
  })

  it('should recompute a pending next sibling after the anchor is cancelled', () => {
    const parent = document.createElement('div')
    const root = document.createElement('i')
    const cancelledAnchor = document.createElement('span')
    const publishedAnchor = document.createElement('b')
    parent.appendChild(root)
    parent.appendChild(cancelledAnchor)
    parent.appendChild(publishedAnchor)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 220)
    setSerializedNodeId(publishedAnchor, 221)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )
    const addRootTask = (node) =>
      controller.addPendingRootTask(node, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    expect(addRootTask(cancelledAnchor)).toBeTrue()
    expect(addRootTask(root)).toBeTrue()
    const cancelledTask = controller.findPendingRootTask(cancelledAnchor)
    cancelledAnchor.remove()
    expect(
      controller.handlePendingRootRemoval(
        cancelledTask,
        cancelledAnchor
      )
    ).toBeTrue()
    expect(controller.flush()).toBeTrue()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    expect(emittedAdds.length).toBe(1)
    expect(emittedAdds[0].node.tagName).toBe('i')
    expect(emittedAdds[0].nextId).toBe(221)

    controller.stop()
    parent.remove()
  })

  it('should recompute sibling anchors after a pending root moves', () => {
    const parent = document.createElement('div')
    const root = document.createElement('i')
    const movedAnchor = document.createElement('span')
    const publishedAnchor = document.createElement('b')
    parent.appendChild(root)
    parent.appendChild(movedAnchor)
    parent.appendChild(publishedAnchor)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 230)
    setSerializedNodeId(publishedAnchor, 231)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )
    const addRootTask = (node) =>
      controller.addPendingRootTask(node, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    expect(addRootTask(movedAnchor)).toBeTrue()
    expect(addRootTask(root)).toBeTrue()
    const movedTask = controller.findPendingRootTask(movedAnchor)
    parent.appendChild(movedAnchor)
    expect(controller.refreshPendingRootTask(movedTask)).toBeTrue()
    expect(controller.flush()).toBeTrue()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const rootAdd = emittedAdds.find((add) => add.node.tagName === 'i')
    const movedAdd = emittedAdds.find(
      (add) => add.node.tagName === 'span'
    )
    expect(movedAdd.nextId).toBeNull()
    expect(rootAdd.nextId).toBe(231)

    controller.stop()
    parent.remove()
  })

  it('should not combine an old parentId with a new-parent sibling anchor', () => {
    const firstParent = document.createElement('div')
    const secondParent = document.createElement('div')
    const publishedAnchor = document.createElement('b')
    const root = document.createElement('span')
    firstParent.appendChild(root)
    secondParent.appendChild(publishedAnchor)
    document.body.appendChild(firstParent)
    document.body.appendChild(secondParent)
    markSerializedAncestors(firstParent, 235)
    markSerializedAncestors(secondParent, 245)
    setSerializedNodeId(publishedAnchor, 255)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )

    expect(
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    secondParent.insertBefore(root, publishedAnchor)
    expect(controller.flush()).toBeTrue()

    const firstAdd = mutationCallback.calls.mostRecent().args[0].adds[0]
    expect(firstAdd.parentId).toBe(getSerializedNodeId(firstParent))
    expect(firstAdd.nextId).toBeNull()

    processMutations(
      [
        {
          type: 'childList',
          target: firstParent,
          addedNodes: [],
          removedNodes: [root]
        },
        {
          type: 'childList',
          target: secondParent,
          addedNodes: [root],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    expect(controller.flush()).toBeTrue()

    const movePayload = mutationCallback.calls.mostRecent().args[0]
    expect(movePayload.removes).toEqual([])
    expect(movePayload.adds[0].node.id).toBe(firstAdd.node.id)
    expect(movePayload.adds[0].parentId).toBe(
      getSerializedNodeId(secondParent)
    )
    expect(movePayload.adds[0].nextId).toBe(255)

    controller.stop()
    firstParent.remove()
    secondParent.remove()
  })

  it('should bound emission-time sibling resolution work', () => {
    let enforceDeadline = false
    let currentTime = 0
    spyOn(performance, 'now').and.callFake(() => {
      if (enforceDeadline) {
        currentTime += MUTATION_NORMALIZATION_MAX_DURATION_MS + 1
      }
      return currentTime
    })
    const parent = document.createElement('div')
    const root = document.createElement('span')
    parent.appendChild(root)
    for (let index = 0; index < 32; index += 1) {
      parent.appendChild(document.createComment('ignored'))
    }
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 260)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    expect(
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    enforceDeadline = true
    controller.flush()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'mutation_sibling_resolution_watermark',
      mutationNodeCount: 32
    })

    controller.stop()
    parent.remove()
  })

  it('should avoid eager sibling scans when adding and refreshing roots', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const root = document.createElement('span')
    parent.appendChild(root)
    for (let index = 0; index < 128; index += 1) {
      const sibling = document.createElement('i')
      setSerializedNodeId(sibling, 1000 + index)
      parent.appendChild(sibling)
    }
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 320)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const isNodeIgnored = jasmine
      .createSpy('isNodeIgnored')
      .and.returnValue(true)
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      undefined,
      undefined,
      isNodeIgnored
    )

    expect(
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    const task = controller.findPendingRootTask(root)
    expect(isNodeIgnored).not.toHaveBeenCalled()
    expect(controller.refreshPendingRootTask(task)).toBeTrue()
    expect(isNodeIgnored).not.toHaveBeenCalled()

    expect(controller.flush()).toBeTrue()
    expect(isNodeIgnored).toHaveBeenCalled()
    expect(mutationCallback.calls.mostRecent().args[0].adds[0].nextId).toBeNull()

    controller.stop()
    parent.remove()
  })

  it('should include sibling cache writes in the emission watermark', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    const root = document.createElement('span')
    parent.appendChild(root)
    for (
      let index = 0;
      index < MAX_PENDING_MUTATION_ROOT_TASKS * 16;
      index += 1
    ) {
      parent.appendChild(document.createComment('ignored'))
    }
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 270)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )

    expect(
      controller.addPendingRootTask(root, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    controller.flush()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'mutation_sibling_resolution_watermark',
      mutationNodeCount: MAX_PENDING_MUTATION_ROOT_TASKS * 32
    })

    controller.stop()
    parent.remove()
  })

  it('should defer dropped-anchor repair until bounded emission', () => {
    const parent = document.createElement('div')
    const roots = Array.from({ length: 64 }, () => {
      const root = document.createElement('i')
      root.setAttribute('data-skip-anchor', '')
      parent.appendChild(root)
      return root
    })
    const droppedAnchor = document.createElement('span')
    const publishedAnchor = document.createElement('b')
    parent.appendChild(droppedAnchor)
    parent.appendChild(publishedAnchor)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 280)
    setSerializedNodeId(publishedAnchor, 290)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback,
      undefined,
      (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        node.hasAttribute('data-skip-anchor')
    )
    const mutationGroup = controller.createMutationGroup()
    const addRootTask = (node, group) =>
      controller.addPendingRootTask(node, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        mutationGroup: group
      })

    expect(addRootTask(droppedAnchor, mutationGroup)).toBeTrue()
    const droppedId = controller.findPendingRootTask(droppedAnchor)
      .serializerTask.serializedNode.id
    roots.forEach((root) => expect(addRootTask(root)).toBeTrue())
    const retainedTasks = roots.map((root) =>
      controller.findPendingRootTask(root)
    )
    retainedTasks.forEach((task) => expect(task.nextId).toBeNull())

    controller.dropMutationGroupTasks(mutationGroup)

    // Dropping one root must stay O(group size); no eager sibling repair runs.
    retainedTasks.forEach((task) => expect(task.nextId).toBeNull())
    controller.cancelMutationGroup(mutationGroup)
    expect(controller.flush()).toBeTrue()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    expect(emittedAdds.length).toBe(roots.length)
    emittedAdds.forEach((add) => expect(add.nextId).toBe(290))
    expect(emittedAdds.some((add) => add.nextId === droppedId)).toBeFalse()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should clear local-drop state when a node becomes a replacement root', () => {
    const parent = document.createElement('div')
    const replacement = document.createElement('span')
    parent.appendChild(replacement)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 240)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (node, requiresBaselineOnDrop) =>
      controller.addPendingRootTask(node, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop
      })

    expect(addRootTask(replacement, false)).toBeTrue()
    const droppedTask = controller.findPendingRootTask(replacement)
    spyOn(droppedTask.serializerTask, 'advance').and.callFake(() => {
      droppedTask.serializerTask.isMaxDepthReached = true
      return false
    })
    expect(controller.flush()).toBeTrue()
    expect(controller.findPendingRootTask(replacement)).toBeUndefined()
    expect(
      shadowRootsController.$rMutationDependencyState.$rLocallyDroppedRoots.has(
        replacement
      )
    ).toBeTrue()

    replacement.remove()
    const intermediate = document.createElement('span')
    parent.appendChild(intermediate)
    expect(addRootTask(intermediate, true)).toBeTrue()
    const intermediateTask = controller.findPendingRootTask(intermediate)
    parent.replaceChild(replacement, intermediate)
    expect(
      controller.$rRetargetPendingRootTask(
        intermediateTask,
        replacement
      )
    ).toBeTrue()
    expect(
      shadowRootsController.$rMutationDependencyState.$rLocallyDroppedRoots.has(
        replacement
      )
    ).toBeFalse()
    expect(controller.flush()).toBeTrue()

    const prepended = document.createElement('i')
    parent.insertBefore(prepended, replacement)
    expect(addRootTask(prepended, false)).toBeTrue()
    expect(controller.flush()).toBeTrue()
    const emittedAdds = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
    const replacementAdd = emittedAdds.find(
      (add) => add.node.tagName === 'span'
    )
    const prependedAdd = emittedAdds.find(
      (add) => add.node.tagName === 'i'
    )
    expect(prependedAdd.nextId).toBe(replacementAdd.node.id)
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should clear local-drop state when an ancestor republishes the node', () => {
    const parent = document.createElement('div')
    const child = document.createElement('span')
    parent.appendChild(child)
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 300)
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {}
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (node) =>
      controller.addPendingRootTask(node, {
        serializedNodeIds: new Set(),
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    expect(addRootTask(child)).toBeTrue()
    const droppedTask = controller.findPendingRootTask(child)
    spyOn(droppedTask.serializerTask, 'advance').and.callFake(() => {
      droppedTask.serializerTask.isMaxDepthReached = true
      return false
    })
    expect(controller.flush()).toBeTrue()
    const dependencyState =
      shadowRootsController.$rMutationDependencyState
    expect(dependencyState.$rLocallyDroppedRoots.has(child)).toBeTrue()

    const ancestor = document.createElement('section')
    ancestor.appendChild(child)
    parent.appendChild(ancestor)
    expect(addRootTask(ancestor)).toBeTrue()
    expect(controller.flush()).toBeTrue()
    expect(dependencyState.$rLocallyDroppedRoots.has(child)).toBeFalse()

    const prepended = document.createElement('i')
    ancestor.insertBefore(prepended, child)
    expect(addRootTask(prepended)).toBeTrue()
    expect(controller.flush()).toBeTrue()
    const prependedAdd = mutationCallback.calls
      .allArgs()
      .flatMap((args) => args[0].adds)
      .find((add) => add.node.tagName === 'i')
    expect(prependedAdd.nextId).toBe(getSerializedNodeId(child))
    expect(mutationOverflowCallback).not.toHaveBeenCalled()

    controller.stop()
    parent.remove()
  })

  it('should emit childList adds asynchronously when not explicitly flushed', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 200)

    const child = document.createElement('div')
    child.appendChild(document.createElement('span'))
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    expect(mutationCallback).not.toHaveBeenCalled()

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).toHaveBeenCalledWith(
      jasmine.objectContaining({
        adds: [
          jasmine.objectContaining({
            parentId: 200,
            node: jasmine.objectContaining({
              tagName: 'div'
            })
          })
        ]
      })
    )
  })

  it('should cancel pending childList adds when reset is called before the async slice runs', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 300)

    const child = document.createElement('div')
    child.appendChild(document.createElement('span'))
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    observer.reset()
    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should discard records still queued by the native observer when reset', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 350)
    const child = document.createElement('div')
    parent.appendChild(child)
    takeRecords.and.returnValue([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observer.reset()

    expect(takeRecords).toHaveBeenCalled()
    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should preserve sibling add ordering and nextId references across async slices', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 400)

    const firstChild = document.createElement('div')
    const secondChild = document.createElement('div')
    parent.appendChild(firstChild)
    parent.appendChild(secondChild)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [firstChild, secondChild],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    const payload = mutationCallback.calls.mostRecent().args[0]
    expect(payload.adds.length).toBe(2)
    expect(payload.adds[0].parentId).toBe(400)
    expect(payload.adds[0].nextId).toBeNull()
    expect(payload.adds[1].parentId).toBe(400)
    expect(payload.adds[1].nextId).toBe(payload.adds[0].node.id)
  })

  it('should cancel a pending root add when the root is removed before the async slice runs', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 500)

    const child = document.createElement('div')
    child.appendChild(document.createElement('span'))
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    parent.removeChild(child)
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [],
        removedNodes: [child]
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should refresh a pending root when its detached descendant is removed behind a sequence gap', () => {
    jasmine.clock().install()
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now)

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 505)

    const blockingRoot = document.createElement('section')
    blockingRoot.appendChild(document.createElement('i'))
    parent.appendChild(blockingRoot)

    const refreshedRoot = document.createElement('article')
    const retainedChild = document.createElement('em')
    const removedChild = document.createElement('span')
    const secondRemovedChild = document.createElement('strong')
    refreshedRoot.appendChild(retainedChild)
    refreshedRoot.appendChild(removedChild)
    refreshedRoot.appendChild(secondRemovedChild)
    parent.appendChild(refreshedRoot)

    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController
    )
    const addRootTask = (root) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })

    expect(addRootTask(blockingRoot)).toBeTrue()
    const blockingTask = controller.findPendingRootTask(blockingRoot)
    let blockingAdvanceCount = 0
    spyOn(blockingTask.serializerTask, 'advance').and.callFake((deadline) => {
      blockingAdvanceCount += 1
      if (blockingAdvanceCount > 1) {
        now = deadline
      }
      return false
    })
    expect(addRootTask(refreshedRoot)).toBeTrue()

    expect(controller.flush()).toBeFalse()
    const refreshedTask = controller.findPendingRootTask(refreshedRoot)
    expect(refreshedTask.isCompleted).not.toBeTrue()
    expect(mutationCallback).not.toHaveBeenCalled()

    refreshedRoot.removeChild(removedChild)
    refreshedRoot.removeChild(secondRemovedChild)
    expect(controller.findPendingRootTask(removedChild)).toBeUndefined()
    processMutations(
      [
        {
          type: 'childList',
          target: refreshedRoot,
          addedNodes: [],
          removedNodes: [removedChild, secondRemovedChild]
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller
    )
    expect(controller.findPendingRootTask(refreshedRoot)).toBe(refreshedTask)
    expect(refreshedTask.refreshCount).toBe(1)
    expect(refreshedTask.isCompleted).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()

    blockingRoot.remove()
    expect(
      controller.handlePendingRootRemoval(blockingTask, blockingRoot)
    ).toBeTrue()
    now = 0
    expect(controller.flush()).toBeTrue()

    expect(mutationCallback).toHaveBeenCalledTimes(1)
    const emittedAdds = mutationCallback.calls.mostRecent().args[0].adds
    expect(emittedAdds.length).toBe(1)
    expect(emittedAdds[0].node.tagName).toBe('article')
    expect(
      emittedAdds[0].node.childNodes.map((node) => node.tagName)
    ).toEqual(['em'])

    controller.stop()
    parent.remove()
  })

  it('should preserve a pending root add when the root is moved to another parent before the async slice runs', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const firstParent = document.createElement('div')
    const secondParent = document.createElement('div')
    document.body.appendChild(firstParent)
    document.body.appendChild(secondParent)
    setSerializedNodeId(firstParent, 510)
    setSerializedNodeId(secondParent, 520)
    markSerializedAncestors(document.body, 530)

    const child = document.createElement('div')
    child.appendChild(document.createElement('span'))
    firstParent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      document.body
    )

    observedCallback([
      {
        type: 'childList',
        target: firstParent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    firstParent.removeChild(child)
    secondParent.appendChild(child)
    observedCallback([
      {
        type: 'childList',
        target: firstParent,
        addedNodes: [],
        removedNodes: [child]
      },
      {
        type: 'childList',
        target: secondParent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).toHaveBeenCalled()
    expect(mutationCallback.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        adds: [
          jasmine.objectContaining({
            parentId: 520,
            node: jasmine.objectContaining({
              tagName: 'div'
            })
          })
        ]
      })
    )
  })

  it('should recover when a published move is removed before its pending add is emitted', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 535)
    const movedRoot = document.createElement('section')
    movedRoot.appendChild(document.createElement('span'))
    parent.appendChild(movedRoot)
    setSerializedNodeId(movedRoot, 545)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    expect(
      controller.addPendingRootTask(movedRoot, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop: true
      })
    ).toBeTrue()
    const movedTask = controller.findPendingRootTask(movedRoot)

    movedRoot.remove()
    expect(
      controller.handlePendingRootRemoval(movedTask, movedRoot)
    ).toBeFalse()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_cancelled'
    })
    controller.stop()
    parent.remove()
  })

  it('should refresh a pending parent after it absorbs a published move dependency', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 546)
    const pendingParent = document.createElement('article')
    const movedRoot = document.createElement('section')
    movedRoot.appendChild(document.createElement('span'))
    parent.appendChild(pendingParent)
    parent.appendChild(movedRoot)
    setSerializedNodeId(movedRoot, 556)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    const addRootTask = (root, requiresBaselineOnDrop) =>
      controller.addPendingRootTask(root, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop
      })

    expect(addRootTask(pendingParent, false)).toBeTrue()
    const pendingParentTask = controller.findPendingRootTask(
      pendingParent
    )
    expect(addRootTask(movedRoot, true)).toBeTrue()
    const movedTask = controller.findPendingRootTask(movedRoot)
    expect(
      pendingParentTask.serializerTask.serializedNode.childNodes
    ).toEqual([])

    pendingParent.appendChild(movedRoot)
    expect(controller.refreshPendingRootTask(movedTask)).toBeTrue()

    expect(pendingParentTask.requiresBaselineOnDrop).toBeTrue()
    expect(pendingParentTask.refreshCount).toBe(1)
    expect(controller.flush()).toBeTrue()
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(mutationCallback).toHaveBeenCalledTimes(1)
    expect(
      mutationCallback.calls.mostRecent().args[0].adds[0].node
        .childNodes[0].tagName
    ).toBe('section')

    controller.stop()
    parent.remove()
  })

  it('should carry a published descendant dependency into a new pending ancestor', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const outerParent = document.createElement('div')
    const oldParent = document.createElement('div')
    outerParent.appendChild(oldParent)
    document.body.appendChild(outerParent)
    markSerializedAncestors(oldParent, 557)

    const movedRoot = document.createElement('section')
    movedRoot.appendChild(document.createElement('span'))
    oldParent.appendChild(movedRoot)
    setSerializedNodeId(movedRoot, 567)
    const pendingAncestor = document.createElement('article')
    oldParent.removeChild(movedRoot)
    pendingAncestor.appendChild(movedRoot)
    outerParent.appendChild(pendingAncestor)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    processMutations(
      [
        {
          type: 'childList',
          target: oldParent,
          addedNodes: [],
          removedNodes: [movedRoot]
        },
        {
          type: 'childList',
          target: outerParent,
          addedNodes: [pendingAncestor],
          removedNodes: []
        }
      ],
      mutationCallback,
      configuration,
      shadowRootsController,
      controller,
      undefined,
      (node) => node === movedRoot
    )

    const pendingAncestorTask = controller.findPendingRootTask(
      pendingAncestor
    )
    expect(pendingAncestorTask.requiresBaselineOnDrop).toBeTrue()
    spyOn(
      pendingAncestorTask.serializerTask,
      'advance'
    ).and.callFake(() => {
      pendingAncestorTask.serializerTask.isMaxApproxBytesReached = true
      pendingAncestorTask.serializerTask.approxBytes = 200001
      return false
    })

    expect(controller.flush()).toBeFalse()
    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_serialization_watermark'
    })
    controller.stop()
    outerParent.remove()
  })

  it('should recover when a published move becomes hidden or ignored before refresh', () => {
    const privacyCases = [
      {
        name: 'hidden',
        createParent: () => {
          const parent = document.createElement('div')
          parent.setAttribute(
            PRIVACY_ATTR_NAME,
            PRIVACY_ATTR_VALUE_HIDDEN
          )
          return parent
        }
      },
      {
        name: 'ignored',
        createParent: () => document.createElement('script')
      }
    ]

    privacyCases.forEach((privacyCase, caseIndex) => {
      const parent = privacyCase.createParent()
      document.body.appendChild(parent)
      const movedRoot = document.createElement('section')
      parent.appendChild(movedRoot)
      setSerializedNodeId(movedRoot, 566 + caseIndex)

      const mutationCallback = jasmine.createSpy(
        privacyCase.name + 'MutationCallback'
      )
      const mutationOverflowCallback = jasmine.createSpy(
        privacyCase.name + 'MutationOverflowCallback'
      )
      const configuration = {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      }
      const shadowRootsController = {
        removeShadowRoot: jasmine.createSpy('removeShadowRoot')
      }
      const controller = createMutationTasksController(
        mutationCallback,
        configuration,
        shadowRootsController,
        undefined,
        mutationOverflowCallback
      )
      expect(
        controller.addPendingRootTask(movedRoot, {
          parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
          serializationContext: {
            status: SerializationContextStatus.MUTATION,
            shadowRootsController
          },
          configuration,
          requiresBaselineOnDrop: true
        })
      ).toBeTrue()
      const movedTask = controller.findPendingRootTask(movedRoot)

      expect(controller.refreshPendingRootTask(movedTask)).toBeFalse()

      expect(mutationCallback).not.toHaveBeenCalled()
      expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
        reason: 'published_move_cancelled'
      })
      controller.stop()
      parent.remove()
    })
  })

  it('should recover when refreshing a published move no longer creates a serializer', () => {
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 568)
    const movedRoot = document.createElement('link')
    movedRoot.setAttribute('rel', 'stylesheet')
    parent.appendChild(movedRoot)
    setSerializedNodeId(movedRoot, 578)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const shadowRootsController = {
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    expect(
      controller.addPendingRootTask(movedRoot, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration,
        requiresBaselineOnDrop: true
      })
    ).toBeTrue()
    const movedTask = controller.findPendingRootTask(movedRoot)
    movedRoot.setAttribute('rel', 'icon')

    expect(controller.refreshPendingRootTask(movedTask)).toBeFalse()

    expect(mutationCallback).not.toHaveBeenCalled()
    expect(mutationOverflowCallback).toHaveBeenCalledOnceWith({
      reason: 'published_move_serialization_failed'
    })
    controller.stop()
    parent.remove()
  })

  it('should not emit a moved pending root twice when it is reparented under another pending root', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    const nextSibling = document.createElement('div')
    document.body.appendChild(parent)
    document.body.appendChild(nextSibling)
    markSerializedAncestors(parent, 610)
    setSerializedNodeId(nextSibling, 620)

    const childRoot = document.createElement('section')
    childRoot.appendChild(document.createElement('span'))
    parent.appendChild(childRoot)

    const newParentRoot = document.createElement('article')
    newParentRoot.appendChild(document.createElement('em'))
    parent.appendChild(newParentRoot)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      document.body
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [childRoot, newParentRoot],
        removedNodes: []
      }
    ])

    parent.removeChild(childRoot)
    newParentRoot.appendChild(childRoot)
    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [],
        removedNodes: [childRoot]
      },
      {
        type: 'childList',
        target: newParentRoot,
        addedNodes: [childRoot],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK * 2)

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .map((args) => args[0])
      .flatMap((payload) => payload.adds)

    expect(emittedAdds.length).toBe(1)
    expect(emittedAdds[0].node.tagName).toBe('article')
    expect(emittedAdds[0].parentId).toBe(610)
    expect(emittedAdds[0].node.childNodes[1].tagName).toBe('section')
  })

  it('should eventually emit all pending roots in a mixed tree scenario', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 550)

    const deepRoot = document.createElement('section')
    let current = deepRoot
    for (let i = 0; i < 400; i += 1) {
      const nested = document.createElement('div')
      current.appendChild(nested)
      current = nested
    }

    const shallowRoot = document.createElement('article')
    shallowRoot.appendChild(document.createElement('span'))

    parent.appendChild(deepRoot)
    parent.appendChild(shallowRoot)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [deepRoot, shallowRoot],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK * 2)

    const addPayloads = mutationCallback.calls
      .allArgs()
      .map((args) => args[0])
      .filter((payload) => payload.adds.length > 0)
    const emittedTagNames = addPayloads
      .flatMap((payload) => payload.adds)
      .map((add) => add.node.tagName)

    expect(emittedTagNames).toEqual(['article', 'section'])
    const emittedAdds = addPayloads.flatMap((payload) => payload.adds)
    expect(emittedAdds[0].nextId).toBeNull()
    expect(emittedAdds[1].nextId).toBe(emittedAdds[0].node.id)
  })

  it('should coalesce completed roots into fewer mutation callbacks across async slices', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 575)

    const roots = []
    for (let rootIndex = 0; rootIndex < 4; rootIndex += 1) {
      const root = document.createElement('section')
      let current = root
      for (let depthIndex = 0; depthIndex < 180; depthIndex += 1) {
        const nested = document.createElement('div')
        current.appendChild(nested)
        current = nested
      }
      roots.push(root)
      parent.appendChild(root)
    }

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: roots,
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK * 2)

    expect(mutationCallback.calls.count()).toBeLessThan(4)
    const emittedTagNames = mutationCallback.calls
      .allArgs()
      .map((args) => args[0])
      .filter((payload) => payload.adds.length > 0)
      .flatMap((payload) => payload.adds)
      .map((add) => add.node.tagName)
    expect(emittedTagNames.filter((tagName) => tagName === 'section').length).toBe(4)
  })

  it('should flush staged completed roots before reset clears pending state', () => {
    spyOn(performance, 'now').and.returnValue(0)
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 590)

    const deepRoot = document.createElement('section')
    let current = deepRoot
    for (let i = 0; i < 400; i += 1) {
      const nested = document.createElement('div')
      current.appendChild(nested)
      current = nested
    }

    const shallowRoot = document.createElement('article')
    shallowRoot.appendChild(document.createElement('span'))

    parent.appendChild(deepRoot)
    parent.appendChild(shallowRoot)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [deepRoot, shallowRoot],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(1)
    observer.flush()
    observer.reset()

    const emittedAdds = mutationCallback.calls
      .allArgs()
      .map((args) => args[0])
      .flatMap((payload) => payload.adds)

    expect(emittedAdds.map((add) => add.node.tagName)).toEqual(['article', 'section'])
  })

  it('should serialize the latest attribute state when an attribute changes before the pending add emits', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 600)

    const child = document.createElement('div')
    child.setAttribute('data-state', 'initial')
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    child.setAttribute('data-state', 'updated')
    observedCallback([
      {
        type: 'attributes',
        target: child,
        attributeName: 'data-state',
        oldValue: 'initial'
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback.calls.count()).toBe(1)
    expect(mutationCallback.calls.mostRecent().args[0].adds[0].node.attributes).toEqual(
      jasmine.objectContaining({
        'data-state': 'updated'
      })
    )
  })

  it('should discard pending attribute updates when reset happens before the async add emits', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 650)

    const child = document.createElement('div')
    child.setAttribute('data-state', 'initial')
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    child.setAttribute('data-state', 'updated')
    observedCallback([
      {
        type: 'attributes',
        target: child,
        attributeName: 'data-state',
        oldValue: 'initial'
      }
    ])

    observer.reset()
    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should serialize the latest text state when character data changes before the pending add emits', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 700)

    const child = document.createElement('div')
    const textNode = document.createTextNode('initial')
    child.appendChild(textNode)
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    textNode.textContent = 'updated'
    observedCallback([
      {
        type: 'characterData',
        target: textNode,
        oldValue: 'initial'
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback.calls.count()).toBe(1)
    expect(
      mutationCallback.calls.mostRecent().args[0].adds[0].node.childNodes[0]
        .textContent
    ).toBe('updated')
  })

  it('should discard pending text updates when reset happens before the async add emits', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 750)

    const child = document.createElement('div')
    const textNode = document.createTextNode('initial')
    child.appendChild(textNode)
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    textNode.textContent = 'updated'
    observedCallback([
      {
        type: 'characterData',
        target: textNode,
        oldValue: 'initial'
      }
    ])

    observer.reset()
    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should not emit hidden privacy roots in the async add path', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 800)

    const child = document.createElement('div')
    child.setAttribute('data-gc-privacy', 'hidden')
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).toHaveBeenCalledTimes(1)
    expect(mutationCallback.calls.mostRecent().args[0].adds[0].node.attributes).toEqual(
      jasmine.objectContaining({
        'data-gc-privacy': 'hidden'
      })
    )
  })

  it('should ignore roots that are ignored elements in the async add path', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 900)

    const child = document.createElement('script')
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback).not.toHaveBeenCalled()
  })

  it('should preserve shadow root serialization behavior in the async add path', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1000)

    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    shadowRoot.appendChild(document.createElement('span'))
    parent.appendChild(host)

    const shadowRootsController = {
      addShadowRoot: jasmine.createSpy('addShadowRoot'),
      removeShadowRoot: jasmine.createSpy('removeShadowRoot')
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      shadowRootsController,
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [host],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(shadowRootsController.addShadowRoot).toHaveBeenCalledWith(
      shadowRoot,
      jasmine.objectContaining({
        $rPublished: false,
        $rQueued: true,
        $rCanceled: false
      })
    )
    expect(mutationCallback.calls.mostRecent().args[0].adds.length).toBe(1)
  })

  it('should rebuild and synchronously flush a pending host after attachShadow', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1050)
    const host = document.createElement('div')
    parent.appendChild(host)
    const addShadowRoot = jasmine
      .createSpy('addShadowRoot')
      .and.returnValue(true)
    const rollbackProvisionalShadowRoots = jasmine.createSpy(
      'rollbackProvisionalShadowRoots'
    )
    const shadowRootsController = {
      addShadowRoot,
      removeShadowRoot: jasmine.createSpy('removeShadowRoot'),
      rollbackProvisionalShadowRoots
    }
    const mutationCallback = jasmine.createSpy('mutationCallback')
    const mutationOverflowCallback = jasmine.createSpy(
      'mutationOverflowCallback'
    )
    const configuration = {
      defaultPrivacyLevel: NodePrivacyLevel.ALLOW
    }
    const controller = createMutationTasksController(
      mutationCallback,
      configuration,
      shadowRootsController,
      undefined,
      mutationOverflowCallback
    )
    expect(
      controller.addPendingRootTask(host, {
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController
        },
        configuration
      })
    ).toBeTrue()
    const pendingHostTask = controller.findPendingRootTask(host)
    const stalePublicationToken = pendingHostTask.publicationToken
    expect(
      JSON.stringify(pendingHostTask.serializerTask.serializedNode)
    ).not.toContain('isShadowRoot')
    const shadowRoot = host.attachShadow({ mode: 'open' })

    expect(
      controller.refreshAndFlushPendingRootForNode(host)
    ).toBeTrue()

    expect(stalePublicationToken.$rCanceled).toBeTrue()
    expect(
      rollbackProvisionalShadowRoots
    ).toHaveBeenCalledWith(stalePublicationToken)
    expect(addShadowRoot).toHaveBeenCalledWith(
      shadowRoot,
      jasmine.objectContaining({
        $rQueued: true,
        $rCanceled: false
      })
    )
    expect(
      JSON.stringify(
        mutationCallback.calls.mostRecent().args[0].adds[0].node
      )
    ).toContain('isShadowRoot')
    expect(mutationOverflowCallback).not.toHaveBeenCalled()
    expect(controller.findPendingRootTask(host)).toBeUndefined()
    controller.stop()
    parent.remove()
  })

  it('should preserve the latest descendant state when multiple pending-root updates happen in one batch', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    document.body.appendChild(parent)
    markSerializedAncestors(parent, 1100)

    const child = document.createElement('div')
    const textNode = document.createTextNode('initial')
    const nested = document.createElement('span')
    nested.setAttribute('data-state', 'initial')
    child.appendChild(textNode)
    child.appendChild(nested)
    parent.appendChild(child)

    const mutationCallback = jasmine.createSpy('mutationCallback')
    startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
    )

    observedCallback([
      {
        type: 'childList',
        target: parent,
        addedNodes: [child],
        removedNodes: []
      }
    ])

    textNode.textContent = 'updated'
    nested.setAttribute('data-state', 'updated')
    nested.appendChild(document.createElement('em'))
    observedCallback([
      {
        type: 'characterData',
        target: textNode,
        oldValue: 'initial'
      },
      {
        type: 'attributes',
        target: nested,
        attributeName: 'data-state',
        oldValue: 'initial'
      },
      {
        type: 'childList',
        target: nested,
        addedNodes: [nested.lastChild],
        removedNodes: []
      }
    ])

    jasmine.clock().tick(ASYNC_MUTATION_TICK)

    expect(mutationCallback.calls.count()).toBe(1)
    const emittedRoot = mutationCallback.calls.mostRecent().args[0].adds[0].node
    expect(emittedRoot.childNodes[0].textContent).toBe('updated')
    expect(emittedRoot.childNodes[1].attributes).toEqual(
      jasmine.objectContaining({
        'data-state': 'updated'
      })
    )
    expect(emittedRoot.childNodes[1].childNodes.length).toBe(1)
    expect(emittedRoot.childNodes[1].childNodes[0].tagName).toBe('em')
  })
})
