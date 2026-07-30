import {
  initShadowRootsController,
  SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT,
  SHADOW_ROOT_CLEANUP_BATCH_SIZE,
  SHADOW_ROOT_FLUSH_MAX_COUNT,
  SHADOW_ROOT_RETIRED_CONTROLLER_LIMIT
} from './shadowRootsController'
import { setSerializedNodeId } from './serializationUtils'

describe('replay/record/shadowRootsController', () => {
  it('should share and restore open attachShadow instrumentation across controllers', () => {
    const originalAttachShadow = Element.prototype.attachShadow
    const firstShadowRootCreated = jasmine.createSpy(
      'firstShadowRootCreated'
    )
    const secondShadowRootCreated = jasmine.createSpy(
      'secondShadowRootCreated'
    )
    const firstController = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        shadowRootCreatedCb: firstShadowRootCreated
      }
    )
    const secondController = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        shadowRootCreatedCb: secondShadowRootCreated
      }
    )

    try {
      expect(Element.prototype.attachShadow).not.toBe(originalAttachShadow)

      const firstHost = document.createElement('div')
      const firstOpenRoot = firstHost.attachShadow({ mode: 'open' })
      expect(firstShadowRootCreated).toHaveBeenCalledOnceWith(
        firstOpenRoot,
        firstHost
      )
      expect(secondShadowRootCreated).toHaveBeenCalledOnceWith(
        firstOpenRoot,
        firstHost
      )

      const closedHost = document.createElement('div')
      closedHost.attachShadow({ mode: 'closed' })
      expect(firstShadowRootCreated).toHaveBeenCalledTimes(1)
      expect(secondShadowRootCreated).toHaveBeenCalledTimes(1)

      firstController.stop()
      const secondHost = document.createElement('div')
      const secondOpenRoot = secondHost.attachShadow({ mode: 'open' })
      expect(firstShadowRootCreated).toHaveBeenCalledTimes(1)
      expect(secondShadowRootCreated).toHaveBeenCalledWith(
        secondOpenRoot,
        secondHost
      )
      expect(secondShadowRootCreated).toHaveBeenCalledTimes(2)

      secondController.stop()
      expect(Element.prototype.attachShadow).toBe(originalAttachShadow)
    } finally {
      firstController.stop()
      secondController.stop()
    }
  })

  it('should ignore unknown shadow roots and support empty flush/reset/stop', () => {
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb: jasmine.createSpy('inputCb')
      }
    )
    const shadowRoot = document.createElement('div').attachShadow({
      mode: 'open'
    })

    expect(() => controller.removeShadowRoot(shadowRoot)).not.toThrow()
    expect(controller.flush()).toBeTrue()
    expect(() => controller.reset()).not.toThrow()
    expect(() => controller.stop()).not.toThrow()
    expect(controller.addShadowRoot(shadowRoot)).toBeFalse()
  })

  it('should clear cross-root mutation dependencies on generation reset', () => {
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {}
      }
    )
    const node = document.createElement('div')
    const dependencyState = controller.$rMutationDependencyState
    dependencyState.$rPublishedRoots.add(node)
    dependencyState.$rLocallyDroppedRoots.add(node)

    controller.reset()

    expect(controller.$rMutationDependencyState).toBe(dependencyState)
    expect(dependencyState.$rPublishedRoots.has(node)).toBeFalse()
    expect(dependencyState.$rLocallyDroppedRoots.has(node)).toBeFalse()
    controller.stop()
  })

  it('should observe active roots and gate the retired generation immediately', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    input.value = 'first'
    setSerializedNodeId(input, 42)
    shadowRoot.appendChild(input)

    const cleanupScheduler = createCleanupScheduler()
    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      {
        defaultPrivacyLevel: undefined
      },
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb,
        scheduleCleanup: cleanupScheduler.schedule
      }
    )

    controller.addShadowRoot(shadowRoot)
    controller.addShadowRoot(shadowRoot)
    input.value = 'active'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(inputCb).toHaveBeenCalledTimes(1)

    controller.reset()
    input.value = 'retired'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(inputCb).toHaveBeenCalledTimes(1)

    controller.addShadowRoot(shadowRoot)
    input.value = 'next-generation'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(inputCb).toHaveBeenCalledTimes(2)
    expect(inputCb).toHaveBeenCalledWith({
      id: 42,
      text: 'next-generation'
    })

    controller.removeShadowRoot(shadowRoot)
    input.value = 'after-removal'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(inputCb).toHaveBeenCalledTimes(2)

    controller.stop()
    cleanupScheduler.drain()
    host.remove()
  })

  it('should clean disconnected roots by scanning the bounded registry', () => {
    const connectedContainer = document.createElement('section')
    const connectedHost = document.createElement('div')
    const disconnectedHost = document.createElement('div')
    const movedDocumentHost = document.createElement('div')
    document.body.appendChild(connectedContainer)
    connectedContainer.appendChild(connectedHost)
    document.body.appendChild(disconnectedHost)
    document.body.appendChild(movedDocumentHost)
    const connectedRoot = connectedHost.attachShadow({ mode: 'open' })
    const disconnectedRoot = disconnectedHost.attachShadow({ mode: 'open' })
    const movedDocumentRoot = movedDocumentHost.attachShadow({
      mode: 'open'
    })
    const connectedInput = document.createElement('input')
    const disconnectedInput = document.createElement('input')
    const movedDocumentInput = document.createElement('input')
    setSerializedNodeId(connectedInput, 43)
    setSerializedNodeId(disconnectedInput, 44)
    setSerializedNodeId(movedDocumentInput, 45)
    connectedRoot.appendChild(connectedInput)
    disconnectedRoot.appendChild(disconnectedInput)
    movedDocumentRoot.appendChild(movedDocumentInput)
    const cleanupScheduler = createCleanupScheduler()
    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      { defaultPrivacyLevel: undefined },
      {
        mutationCb: function () {},
        inputCb,
        scheduleCleanup: cleanupScheduler.schedule
      }
    )

    controller.addShadowRoot(connectedRoot)
    controller.addShadowRoot(disconnectedRoot)
    controller.addShadowRoot(movedDocumentRoot)
    document.body.appendChild(connectedHost)
    disconnectedHost.remove()
    const foreignDocument = document.implementation.createHTMLDocument(
      'foreign'
    )
    foreignDocument.body.appendChild(
      foreignDocument.adoptNode(movedDocumentHost)
    )
    controller.cleanupDisconnectedShadowRoots()

    disconnectedInput.value = 'detached'
    disconnectedInput.dispatchEvent(new Event('change', { bubbles: true }))
    movedDocumentInput.value = 'foreign-document'
    movedDocumentInput.dispatchEvent(new Event('change', { bubbles: true }))
    connectedInput.value = 'connected'
    connectedInput.dispatchEvent(new Event('change', { bubbles: true }))

    expect(inputCb).toHaveBeenCalledOnceWith({
      id: 43,
      text: 'connected'
    })
    controller.stop()
    cleanupScheduler.drain()
    connectedHost.remove()
    connectedContainer.remove()
  })

  it('should continue disconnected root cleanup when one observer throws', () => {
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    const firstRoot = firstHost.attachShadow({ mode: 'open' })
    const secondRoot = secondHost.attachShadow({ mode: 'open' })
    const cleanupErrorCb = jasmine.createSpy('cleanupErrorCb')
    const deactivateFirst = jasmine
      .createSpy('deactivateFirst')
      .and.throwError('deactivate failed')
    const deactivateSecond = jasmine.createSpy('deactivateSecond')
    let observerIndex = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        cleanupErrorCb,
        startMutationObserver: function () {
          const deactivate =
            observerIndex === 0 ? deactivateFirst : deactivateSecond
          observerIndex += 1
          return {
            deactivate,
            flush: function () {
              return true
            },
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    controller.addShadowRoot(firstRoot)
    controller.addShadowRoot(secondRoot)

    expect(() => controller.cleanupDisconnectedShadowRoots()).not.toThrow()
    expect(deactivateFirst).toHaveBeenCalledTimes(1)
    expect(deactivateSecond).toHaveBeenCalledTimes(1)
    expect(cleanupErrorCb).toHaveBeenCalledTimes(1)

    controller.cleanupDisconnectedShadowRoots()
    expect(deactivateFirst).toHaveBeenCalledTimes(1)
    expect(deactivateSecond).toHaveBeenCalledTimes(1)
    controller.stop()
  })

  it('should restore published shadow root observers after a recovery generation is abandoned', () => {
    const firstHost = document.createElement('div')
    const secondHost = document.createElement('div')
    document.body.appendChild(firstHost)
    document.body.appendChild(secondHost)
    const firstRoot = firstHost.attachShadow({ mode: 'open' })
    const secondRoot = secondHost.attachShadow({ mode: 'open' })
    const firstInput = document.createElement('input')
    const secondInput = document.createElement('input')
    setSerializedNodeId(firstInput, 420)
    setSerializedNodeId(secondInput, 421)
    firstRoot.appendChild(firstInput)
    secondRoot.appendChild(secondInput)

    const cleanupScheduler = createCleanupScheduler()
    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      { defaultPrivacyLevel: undefined },
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb,
        scheduleCleanup: cleanupScheduler.schedule
      }
    )

    controller.addShadowRoot(firstRoot)
    controller.$rBeginRecovery()
    controller.reset()
    // Simulate a partial replacement snapshot that only reached a later root.
    controller.addShadowRoot(secondRoot)
    controller.$rRollbackRecovery()

    firstInput.value = 'restored'
    firstInput.dispatchEvent(new Event('change', { bubbles: true }))
    secondInput.value = 'retired-partial-generation'
    secondInput.dispatchEvent(new Event('change', { bubbles: true }))

    expect(inputCb).toHaveBeenCalledOnceWith({
      id: 420,
      text: 'restored'
    })

    controller.stop()
    cleanupScheduler.drain()
    firstHost.remove()
    secondHost.remove()
  })

  it('should restore only recovery roots that still belong to the observed document', () => {
    const firstContainer = document.createElement('section')
    const secondContainer = document.createElement('section')
    const movedHost = document.createElement('div')
    const foreignHost = document.createElement('div')
    document.body.appendChild(firstContainer)
    document.body.appendChild(secondContainer)
    firstContainer.appendChild(movedHost)
    firstContainer.appendChild(foreignHost)
    const movedRoot = movedHost.attachShadow({ mode: 'open' })
    const foreignRoot = foreignHost.attachShadow({ mode: 'open' })
    const movedInput = document.createElement('input')
    const foreignInput = document.createElement('input')
    setSerializedNodeId(movedInput, 423)
    setSerializedNodeId(foreignInput, 424)
    movedRoot.appendChild(movedInput)
    foreignRoot.appendChild(foreignInput)
    const cleanupScheduler = createCleanupScheduler()
    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      { defaultPrivacyLevel: undefined },
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb,
        scheduleCleanup: cleanupScheduler.schedule
      }
    )

    controller.addShadowRoot(movedRoot)
    controller.addShadowRoot(foreignRoot)
    controller.$rBeginRecovery()
    secondContainer.appendChild(movedHost)
    const foreignDocument = document.implementation.createHTMLDocument(
      'foreign'
    )
    foreignDocument.body.appendChild(
      foreignDocument.adoptNode(foreignHost)
    )
    controller.cleanupDisconnectedShadowRoots()
    controller.$rRollbackRecovery()

    movedInput.value = 'same-document-move'
    movedInput.dispatchEvent(new Event('change', { bubbles: true }))
    foreignInput.value = 'foreign-document'
    foreignInput.dispatchEvent(new Event('change', { bubbles: true }))

    expect(inputCb).toHaveBeenCalledOnceWith({
      id: 423,
      text: 'same-document-move'
    })

    controller.stop()
    cleanupScheduler.drain()
    firstContainer.remove()
    secondContainer.remove()
  })

  it('should restore a provisional shadow root committed after recovery begins', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    setSerializedNodeId(input, 422)
    shadowRoot.appendChild(input)
    const cleanupScheduler = createCleanupScheduler()
    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      { defaultPrivacyLevel: undefined },
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb,
        scheduleCleanup: cleanupScheduler.schedule
      }
    )
    const publicationOwner = {}

    controller.addShadowRoot(shadowRoot, publicationOwner)
    controller.$rBeginRecovery()
    controller.commitProvisionalShadowRoots(publicationOwner)
    controller.reset()
    controller.$rRollbackRecovery()

    input.value = 'restored-after-commit'
    input.dispatchEvent(new Event('change', { bubbles: true }))
    expect(inputCb).toHaveBeenCalledOnceWith({
      id: 422,
      text: 'restored-after-commit'
    })

    controller.stop()
    cleanupScheduler.drain()
    host.remove()
  })

  it('should route a pending nested host refresh to its active shadow mutation controller', () => {
    const refreshAndFlushPendingRootForNode = jasmine
      .createSpy('refreshAndFlushPendingRootForNode')
      .and.returnValue(true)
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        startMutationObserver: function () {
          return {
            deactivate: function () {},
            flush: function () {
              return true
            },
            refreshAndFlushPendingRootForNode,
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    const outerHost = document.createElement('div')
    const outerShadowRoot = outerHost.attachShadow({ mode: 'open' })
    const nestedHost = document.createElement('section')
    outerShadowRoot.appendChild(nestedHost)

    expect(controller.addShadowRoot(outerShadowRoot)).toBeTrue()
    expect(
      controller.refreshAndFlushPendingRootForNode(nestedHost)
    ).toBeTrue()
    expect(
      refreshAndFlushPendingRootForNode
    ).toHaveBeenCalledOnceWith(nestedHost)

    controller.reset()
    expect(
      controller.refreshAndFlushPendingRootForNode(nestedHost)
    ).toBeUndefined()
    controller.stop()
  })

  it('should keep a retired root and its descendants skipped until the root is registered again', () => {
    const cleanupScheduler = createCleanupScheduler()
    const controller = createStubbedController({
      scheduleCleanup: cleanupScheduler.schedule
    })
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const descendant = document.createElement('span')
    shadowRoot.appendChild(descendant)

    expect(controller.addShadowRoot(shadowRoot)).toBeTrue()
    expect(controller.isNodeInSkippedShadowRoot(shadowRoot)).toBeFalse()
    expect(controller.isNodeInSkippedShadowRoot(descendant)).toBeFalse()

    controller.reset()

    // The root placeholder itself is published in the baseline; only content
    // behind that boundary is skipped.
    expect(controller.isNodeInSkippedShadowRoot(shadowRoot)).toBeFalse()
    expect(controller.isNodeInSkippedShadowRoot(descendant)).toBeTrue()

    expect(controller.addShadowRoot(shadowRoot)).toBeTrue()
    expect(controller.isNodeInSkippedShadowRoot(shadowRoot)).toBeFalse()
    expect(controller.isNodeInSkippedShadowRoot(descendant)).toBeFalse()

    controller.stop()
    cleanupScheduler.drain()
  })

  it('should roll back only shadow roots provisionally owned by a rejected add', () => {
    const cleanupScheduler = createCleanupScheduler()
    const deactivateMutationObserver = jasmine.createSpy(
      'deactivateMutationObserver'
    )
    const stopMutationObserver = jasmine.createSpy('stopMutationObserver')
    const startMutationObserver = jasmine
      .createSpy('startMutationObserver')
      .and.callFake(() => ({
        deactivate: deactivateMutationObserver,
        flush: () => true,
        stop: stopMutationObserver
      }))
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: () => {},
        inputCb: () => {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver,
        initInputObserver: () => () => {}
      }
    )
    const existingRoot = createFakeShadowRoot(100)
    const rejectedRoot = createFakeShadowRoot(101)
    const committedRoot = createFakeShadowRoot(102)
    const rejectedOwner = {}
    const committedOwner = {}

    expect(controller.addShadowRoot(existingRoot)).toBeTrue()
    expect(
      controller.addShadowRoot(existingRoot, rejectedOwner)
    ).toBeTrue()
    expect(
      controller.addShadowRoot(rejectedRoot, rejectedOwner)
    ).toBeTrue()
    expect(startMutationObserver).toHaveBeenCalledTimes(2)

    controller.rollbackProvisionalShadowRoots(rejectedOwner)

    expect(deactivateMutationObserver).toHaveBeenCalledTimes(1)
    expect(controller.addShadowRoot(existingRoot)).toBeTrue()
    expect(startMutationObserver).toHaveBeenCalledTimes(2)
    expect(controller.addShadowRoot(rejectedRoot)).toBeTrue()
    expect(startMutationObserver).toHaveBeenCalledTimes(3)

    expect(
      controller.addShadowRoot(committedRoot, committedOwner)
    ).toBeTrue()
    controller.commitProvisionalShadowRoots(committedOwner)
    controller.rollbackProvisionalShadowRoots(committedOwner)
    expect(controller.addShadowRoot(committedRoot)).toBeTrue()
    expect(startMutationObserver).toHaveBeenCalledTimes(4)

    cleanupScheduler.drain()
    expect(stopMutationObserver).toHaveBeenCalledTimes(1)
    controller.stop()
    cleanupScheduler.drain()
  })

  it('should release provisional shadow-root capacity before sliced cleanup', () => {
    const cleanupScheduler = createCleanupScheduler()
    const startMutationObserver = jasmine
      .createSpy('startMutationObserver')
      .and.callFake(() => ({
        deactivate: () => {},
        flush: () => true,
        stop: () => {}
      }))
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: () => {},
        inputCb: () => {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver,
        initInputObserver: () => () => {}
      }
    )
    const owner = {}
    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
      index += 1
    ) {
      expect(
        controller.addShadowRoot(createFakeShadowRoot(index), owner)
      ).toBeTrue()
    }
    expect(
      controller.addShadowRoot(
        createFakeShadowRoot(SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT),
        owner
      )
    ).toBeNull()

    controller.rollbackProvisionalShadowRoots(owner)

    expect(
      controller.addShadowRoot(
        createFakeShadowRoot(SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT + 1)
      )
    ).toBeTrue()
    expect(startMutationObserver).toHaveBeenCalledTimes(
      SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT + 1
    )
    expect(cleanupScheduler.pendingCount()).toBeGreaterThan(0)

    controller.stop()
    cleanupScheduler.drain()
  })

  it('should skip the 65th root and descendants behind a nested skipped ancestor', () => {
    const cleanupScheduler = createCleanupScheduler()
    const controller = createStubbedController({
      scheduleCleanup: cleanupScheduler.schedule
    })
    let admittedDescendant

    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
      index += 1
    ) {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const descendant = document.createElement('span')
      shadowRoot.appendChild(descendant)
      if (index === 0) {
        admittedDescendant = descendant
      }
      expect(controller.addShadowRoot(shadowRoot)).toBeTrue()
    }

    const skippedHost = document.createElement('div')
    const skippedShadowRoot = skippedHost.attachShadow({ mode: 'open' })
    const nestedHost = document.createElement('div')
    skippedShadowRoot.appendChild(nestedHost)
    const nestedShadowRoot = nestedHost.attachShadow({ mode: 'open' })
    const nestedDescendant = document.createElement('span')
    nestedShadowRoot.appendChild(nestedDescendant)

    expect(controller.addShadowRoot(skippedShadowRoot)).toBeNull()
    expect(
      controller.isNodeInSkippedShadowRoot(skippedShadowRoot)
    ).toBeFalse()
    expect(controller.isNodeInSkippedShadowRoot(nestedShadowRoot)).toBeTrue()
    expect(
      controller.isNodeInSkippedShadowRoot(nestedDescendant)
    ).toBeTrue()
    expect(
      controller.isNodeInSkippedShadowRoot(admittedDescendant)
    ).toBeFalse()

    controller.stop()
    cleanupScheduler.drain()
  })

  it('should recover instead of emitting a shadow mutation before its root is published', () => {
    const cleanupScheduler = createCleanupScheduler()
    const mutationCb = jasmine.createSpy('mutationCb')
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    let nextMutationCb
    let rootPublished = false
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        mutationOverflowCb,
        inputCb: function () {},
        isNodeIgnored: function () {
          return !rootPublished
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (callback) {
          nextMutationCb = callback
          return {
            flush: function () {
              return true
            },
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    controller.addShadowRoot(shadowRoot)

    nextMutationCb({ adds: [], removes: [], texts: [], attributes: [] })
    expect(mutationCb).not.toHaveBeenCalled()
    expect(mutationOverflowCb).toHaveBeenCalledOnceWith({
      reason: 'shadow_root_mutation_before_publication'
    })

    rootPublished = true
    nextMutationCb({ adds: [], removes: [], texts: [], attributes: [] })
    expect(mutationCb).toHaveBeenCalledTimes(1)

    controller.stop()
    cleanupScheduler.drain()
  })

  it('should gate every retired callback before cleanup and allow a new generation', () => {
    const cleanupScheduler = createCleanupScheduler()
    const callbacks = []
    const mutationCb = jasmine.createSpy('mutationCb')
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    const mutationActivityCb = jasmine.createSpy('mutationActivityCb')
    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        mutationOverflowCb,
        mutationActivityCb,
        inputCb,
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (
          nextMutationCb,
          _configuration,
          nextShadowRootsController,
          _shadowRoot,
          _mutationPerfCb,
          nextOverflowCb,
          nextActivityCb
        ) {
          callbacks.push({
            activity: nextActivityCb,
            controller: nextShadowRootsController,
            mutation: nextMutationCb,
            overflow: nextOverflowCb
          })
          return {
            flush: function () {
              return true
            },
            stop: function () {}
          }
        },
        initInputObserver: function (nextInputCb) {
          callbacks[callbacks.length - 1].input = nextInputCb
          return function () {}
        }
      }
    )

    controller.addShadowRoot(createFakeShadowRoot(1))
    const retiredCallbacks = callbacks[0]
    controller.reset()

    retiredCallbacks.mutation({ adds: [1] })
    retiredCallbacks.overflow({ reason: 'old' })
    retiredCallbacks.activity()
    retiredCallbacks.input({ id: 1 })
    expect(mutationCb).not.toHaveBeenCalled()
    expect(mutationOverflowCb).not.toHaveBeenCalled()
    expect(mutationActivityCb).not.toHaveBeenCalled()
    expect(inputCb).not.toHaveBeenCalled()

    const activeShadowRoot = createFakeShadowRoot(2)
    controller.addShadowRoot(activeShadowRoot)
    const activeCallbacks = callbacks[1]
    expect(
      retiredCallbacks.controller.addShadowRoot(createFakeShadowRoot(3))
    ).toBeFalse()
    retiredCallbacks.controller.removeShadowRoot(activeShadowRoot)
    retiredCallbacks.controller.reset()
    expect(callbacks.length).toBe(2)

    activeCallbacks.mutation({ adds: [2] })
    activeCallbacks.overflow({ reason: 'active' })
    activeCallbacks.activity()
    activeCallbacks.input({ id: 2 })
    expect(mutationCb).toHaveBeenCalledWith({ adds: [2] })
    expect(mutationOverflowCb).toHaveBeenCalledWith({ reason: 'active' })
    expect(mutationActivityCb).toHaveBeenCalled()
    expect(inputCb).toHaveBeenCalledWith({ id: 2 })

    expect(
      activeCallbacks.controller.addShadowRoot(createFakeShadowRoot(4))
    ).toBeTrue()
    expect(callbacks.length).toBe(3)

    controller.stop()
    mutationCb.calls.reset()
    mutationOverflowCb.calls.reset()
    mutationActivityCb.calls.reset()
    inputCb.calls.reset()
    activeCallbacks.mutation({ adds: [3] })
    activeCallbacks.overflow({ reason: 'stopped' })
    activeCallbacks.activity()
    activeCallbacks.input({ id: 3 })
    expect(mutationCb).not.toHaveBeenCalled()
    expect(mutationOverflowCb).not.toHaveBeenCalled()
    expect(mutationActivityCb).not.toHaveBeenCalled()
    expect(inputCb).not.toHaveBeenCalled()
    cleanupScheduler.drain()
  })

  it('should deactivate native mutation work before sliced disconnect cleanup', () => {
    const cleanupScheduler = createCleanupScheduler()
    const nativeMutationEntries = []
    const mutationCb = jasmine.createSpy('mutationCb')
    let nativeWorkCount = 0
    let disconnectCount = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        inputCb: function () {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (nextMutationCb) {
          let active = true
          nativeMutationEntries.push(function () {
            if (!active) {
              return
            }
            nativeWorkCount += 1
            nextMutationCb({ adds: [nativeWorkCount] })
          })
          return {
            deactivate: function () {
              active = false
            },
            flush: function () {
              return true
            },
            stop: function () {
              disconnectCount += 1
            }
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    controller.addShadowRoot(createFakeShadowRoot(1))

    nativeMutationEntries[0]()
    expect(nativeWorkCount).toBe(1)
    expect(mutationCb).toHaveBeenCalledTimes(1)

    controller.reset()
    nativeMutationEntries[0]()

    expect(nativeWorkCount).toBe(1)
    expect(mutationCb).toHaveBeenCalledTimes(1)
    expect(disconnectCount).toBe(0)
    expect(cleanupScheduler.pendingCount()).toBe(1)

    cleanupScheduler.drain()
    expect(disconnectCount).toBe(1)
  })

  it('should preserve the overflow paired with an observer-triggered generation reset', () => {
    const cleanupScheduler = createCleanupScheduler()
    const callbacks = []
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        mutationOverflowCb,
        inputCb: function () {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (
          _nextMutationCb,
          _configuration,
          nextShadowRootsController,
          _shadowRoot,
          _mutationPerfCb,
          nextOverflowCb
        ) {
          callbacks.push({
            controller: nextShadowRootsController,
            overflow: nextOverflowCb
          })
          return {
            flush: function () {
              return true
            },
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    controller.addShadowRoot(createFakeShadowRoot(1))

    callbacks[0].controller.reset()
    expect(mutationOverflowCb).not.toHaveBeenCalled()
    callbacks[0].overflow({ reason: 'removed_subtree_watermark' })
    callbacks[0].overflow({ reason: 'late_duplicate' })

    expect(mutationOverflowCb).toHaveBeenCalledTimes(1)
    expect(mutationOverflowCb).toHaveBeenCalledWith({
      reason: 'removed_subtree_watermark'
    })
    cleanupScheduler.drain()
  })

  it('should release a full active controller generation in bounded async slices', () => {
    const cleanupScheduler = createCleanupScheduler()
    const rootCount = SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT
    let mutationDeactivateCount = 0
    let mutationStopCount = 0
    let inputStopCount = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        getCurrentTime: function () {
          return 0
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function () {
          return {
            deactivate: function () {
              mutationDeactivateCount += 1
            },
            flush: function () {
              return true
            },
            stop: function () {
              mutationStopCount += 1
            }
          }
        },
        initInputObserver: function () {
          return function () {
            inputStopCount += 1
          }
        }
      }
    )

    for (let index = 0; index < rootCount; index += 1) {
      controller.addShadowRoot(createFakeShadowRoot(index))
    }
    controller.reset()

    expect(mutationDeactivateCount).toBe(rootCount)
    expect(mutationStopCount).toBe(0)
    expect(inputStopCount).toBe(0)
    expect(cleanupScheduler.pendingCount()).toBe(1)
    cleanupScheduler.runNext()
    expect(mutationStopCount).toBe(SHADOW_ROOT_CLEANUP_BATCH_SIZE)
    expect(inputStopCount).toBe(SHADOW_ROOT_CLEANUP_BATCH_SIZE)

    cleanupScheduler.drain()
    expect(mutationStopCount).toBe(rootCount)
    expect(inputStopCount).toBe(rootCount)
  })

  it('should not enqueue more retired maps for repeated empty resets', () => {
    const cleanupScheduler = createCleanupScheduler()
    const controller = createStubbedController({
      scheduleCleanup: cleanupScheduler.schedule
    })
    controller.addShadowRoot(createFakeShadowRoot(1))
    controller.reset()

    for (let index = 0; index < 1000; index += 1) {
      controller.reset()
    }

    expect(cleanupScheduler.scheduledCount()).toBe(1)
    expect(cleanupScheduler.pendingCount()).toBe(1)
    cleanupScheduler.drain()
  })

  it('should converge across many non-empty retired generations with one active cleanup chain', () => {
    const cleanupScheduler = createCleanupScheduler()
    const rootsPerGeneration = 20
    const generationCount = Math.floor(
      SHADOW_ROOT_RETIRED_CONTROLLER_LIMIT / rootsPerGeneration
    )
    let stopCount = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        getCurrentTime: function () {
          return 0
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function () {
          return {
            flush: function () {
              return true
            },
            stop: function () {
              stopCount += 1
            }
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )

    for (
      let generationIndex = 0;
      generationIndex < generationCount;
      generationIndex += 1
    ) {
      for (let rootIndex = 0; rootIndex < rootsPerGeneration; rootIndex += 1) {
        controller.addShadowRoot(
          createFakeShadowRoot(
            generationIndex * rootsPerGeneration + rootIndex
          )
        )
      }
      controller.reset()
    }

    expect(stopCount).toBe(0)
    expect(cleanupScheduler.scheduledCount()).toBe(1)
    cleanupScheduler.drain()
    expect(stopCount).toBe(generationCount * rootsPerGeneration)
    expect(cleanupScheduler.pendingCount()).toBe(0)
  })

  it('should fall back to the default async scheduler when a custom scheduler throws', () => {
    jasmine.clock().install()
    let stopCount = 0
    const cleanupErrorCb = jasmine.createSpy('cleanupErrorCb')
    const schedulingError = new Error('custom scheduler failed')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        cleanupErrorCb,
        scheduleCleanup: function () {
          throw schedulingError
        },
        startMutationObserver: function () {
          return {
            flush: function () {
              return true
            },
            stop: function () {
              stopCount += 1
            }
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )

    try {
      controller.addShadowRoot(createFakeShadowRoot(1))
      controller.reset()
      expect(stopCount).toBe(0)
      expect(cleanupErrorCb).toHaveBeenCalledWith(schedulingError)

      jasmine.clock().tick(1)
      expect(stopCount).toBe(1)
    } finally {
      controller.stop()
      jasmine.clock().uninstall()
    }
  })

  it('should atomically discard buffered shadow mutations when the flush time budget is exceeded', () => {
    const cleanupScheduler = createCleanupScheduler()
    const mutationCb = jasmine.createSpy('mutationCb')
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    const flushes = []
    let now = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        mutationOverflowCb,
        inputCb: function () {},
        getCurrentTime: function () {
          const current = now
          now += 5
          return current
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (nextMutationCb) {
          const flush = jasmine.createSpy('flush').and.callFake(function () {
            nextMutationCb({ adds: [flushes.length] })
            return true
          })
          flushes.push(flush)
          return {
            flush,
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    controller.addShadowRoot(createFakeShadowRoot(1))
    controller.addShadowRoot(createFakeShadowRoot(2))

    expect(controller.flush()).toBeFalse()
    expect(flushes[0]).toHaveBeenCalled()
    expect(flushes[1]).not.toHaveBeenCalled()
    expect(mutationCb).not.toHaveBeenCalled()
    expect(mutationOverflowCb).toHaveBeenCalledTimes(1)
    expect(mutationOverflowCb.calls.mostRecent().args[0].reason).toBe(
      'shadow_root_flush_budget'
    )
    cleanupScheduler.drain()
  })

  it('should align admission with the flush limit and keep admitted roots recoverable', () => {
    const cleanupScheduler = createCleanupScheduler()
    const flush = jasmine.createSpy('flush').and.returnValue(true)
    const callbacks = []
    const mutationCb = jasmine.createSpy('mutationCb')
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        mutationOverflowCb,
        inputCb: function () {},
        getCurrentTime: function () {
          return 0
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (nextMutationCb) {
          callbacks.push(nextMutationCb)
          return {
            flush,
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    for (
      let index = 0;
      index < SHADOW_ROOT_FLUSH_MAX_COUNT;
      index += 1
    ) {
      expect(
        controller.addShadowRoot(createFakeShadowRoot(index))
      ).toBeTrue()
    }
    expect(
      controller.addShadowRoot(
        createFakeShadowRoot(SHADOW_ROOT_FLUSH_MAX_COUNT)
      )
    ).toBeNull()

    expect(controller.flush()).toBeTrue()
    expect(flush).toHaveBeenCalledTimes(SHADOW_ROOT_FLUSH_MAX_COUNT)
    expect(mutationOverflowCb).not.toHaveBeenCalled()
    callbacks[0]({ adds: [1] })
    expect(mutationCb).toHaveBeenCalledOnceWith({ adds: [1] })
    cleanupScheduler.drain()
  })

  it('should discard every buffered callback when one root flush overflows', () => {
    const cleanupScheduler = createCleanupScheduler()
    const mutationCb = jasmine.createSpy('mutationCb')
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    let nextObserver = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        mutationOverflowCb,
        inputCb: function () {},
        getCurrentTime: function () {
          return 0
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (
          nextMutationCb,
          _configuration,
          _shadowRootsController,
          _shadowRoot,
          _mutationPerfCb,
          nextOverflowCb
        ) {
          const observerIndex = nextObserver
          nextObserver += 1
          return {
            flush: function () {
              nextMutationCb({ adds: [observerIndex] })
              if (observerIndex === 1) {
                nextOverflowCb({ reason: 'serialization_budget' })
                return false
              }
              return true
            },
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    controller.addShadowRoot(createFakeShadowRoot(1))
    controller.addShadowRoot(createFakeShadowRoot(2))

    expect(controller.flush()).toBeFalse()
    expect(mutationCb).not.toHaveBeenCalled()
    expect(mutationOverflowCb).toHaveBeenCalledTimes(1)
    expect(mutationOverflowCb.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        reason: 'shadow_root_flush_overflow',
        cause: 'serialization_budget'
      })
    )
    cleanupScheduler.drain()
  })

  it('should recover atomically when an observer resets its generation during flush', () => {
    const cleanupScheduler = createCleanupScheduler()
    const mutationCb = jasmine.createSpy('mutationCb')
    const mutationOverflowCb = jasmine.createSpy('mutationOverflowCb')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        mutationOverflowCb,
        inputCb: function () {},
        getCurrentTime: function () {
          return 0
        },
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (
          nextMutationCb,
          _configuration,
          nextShadowRootsController,
          _shadowRoot,
          _mutationPerfCb,
          nextOverflowCb
        ) {
          return {
            flush: function () {
              nextMutationCb({ adds: [1] })
              nextShadowRootsController.reset()
              nextOverflowCb({ reason: 'removed_subtree_watermark' })
              return true
            },
            stop: function () {}
          }
        },
        initInputObserver: function () {
          return function () {}
        }
      }
    )
    controller.addShadowRoot(createFakeShadowRoot(1))

    expect(controller.flush()).toBeFalse()
    expect(mutationCb).not.toHaveBeenCalled()
    expect(mutationOverflowCb).toHaveBeenCalledTimes(1)
    expect(mutationOverflowCb.calls.mostRecent().args[0]).toEqual(
      jasmine.objectContaining({
        reason: 'shadow_root_flush_overflow',
        cause: 'removed_subtree_watermark'
      })
    )
    cleanupScheduler.drain()
  })

  it('should invalidate stop synchronously and release resources asynchronously', () => {
    const cleanupScheduler = createCleanupScheduler()
    const callbacks = []
    let stopCount = 0
    const mutationCb = jasmine.createSpy('mutationCb')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb,
        inputCb: function () {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function (nextMutationCb) {
          callbacks.push(nextMutationCb)
          return {
            flush: function () {
              return true
            },
            stop: function () {
              stopCount += 1
            }
          }
        },
        initInputObserver: function () {
          return function () {
            stopCount += 1
          }
        }
      }
    )
    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
      index += 1
    ) {
      controller.addShadowRoot(createFakeShadowRoot(index))
    }

    controller.stop()
    expect(stopCount).toBe(0)
    callbacks[0]({ adds: [1] })
    expect(mutationCb).not.toHaveBeenCalled()
    cleanupScheduler.runNext()
    expect(stopCount).toBe(SHADOW_ROOT_CLEANUP_BATCH_SIZE * 2)
    cleanupScheduler.drain()
    expect(stopCount).toBe(SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT * 2)
    expect(() => controller.stop()).not.toThrow()
  })

  it('should run both cleanup tasks and continue after one observer throws', () => {
    const cleanupScheduler = createCleanupScheduler()
    const firstError = new Error('first stop failed')
    const cleanupErrorCb = jasmine.createSpy('cleanupErrorCb')
    const mutationStops = [
      jasmine.createSpy('firstMutationStop').and.throwError(firstError),
      jasmine.createSpy('secondMutationStop')
    ]
    const inputStops = [
      jasmine.createSpy('firstInputStop'),
      jasmine.createSpy('secondInputStop')
    ]
    let nextObserver = 0
    let nextInput = 0
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb: jasmine.createSpy('inputCb'),
        cleanupErrorCb,
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: function () {
          const stop = mutationStops[nextObserver]
          nextObserver += 1
          return {
            flush: function () {
              return true
            },
            stop
          }
        },
        initInputObserver: function () {
          const stop = inputStops[nextInput]
          nextInput += 1
          return stop
        }
      }
    )
    controller.addShadowRoot(createFakeShadowRoot(1))
    controller.addShadowRoot(createFakeShadowRoot(2))

    expect(() => controller.stop()).not.toThrow()
    expect(mutationStops[0]).not.toHaveBeenCalled()
    cleanupScheduler.drain()
    expect(mutationStops[0]).toHaveBeenCalled()
    expect(mutationStops[1]).toHaveBeenCalled()
    expect(inputStops[0]).toHaveBeenCalled()
    expect(inputStops[1]).toHaveBeenCalled()
    expect(cleanupErrorCb).toHaveBeenCalledWith(firstError)
  })

  it('should report a synchronous deactivation failure only once', () => {
    const deactivationError = new Error('deactivation failed')
    const cleanupErrorCb = jasmine.createSpy('cleanupErrorCb')
    const mutationStop = jasmine.createSpy('mutationStop')
    const inputStop = jasmine.createSpy('inputStop')
    const shadowRoot = createFakeShadowRoot(1)
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: function () {},
        inputCb: function () {},
        cleanupErrorCb,
        startMutationObserver: function () {
          return {
            deactivate: function () {
              throw deactivationError
            },
            flush: function () {
              return true
            },
            stop: mutationStop
          }
        },
        initInputObserver: function () {
          return inputStop
        }
      }
    )
    controller.addShadowRoot(shadowRoot)

    expect(() => controller.removeShadowRoot(shadowRoot)).toThrow(
      deactivationError
    )
    expect(mutationStop).toHaveBeenCalledTimes(1)
    expect(inputStop).toHaveBeenCalledTimes(1)
    expect(cleanupErrorCb).toHaveBeenCalledOnceWith(deactivationError)
  })

  it('should fail closed before creating an unbounded active observer set', () => {
    const cleanupScheduler = createCleanupScheduler()
    const startMutationObserver = jasmine
      .createSpy('startMutationObserver')
      .and.callFake(() => ({
        flush: () => true,
        stop: () => {}
      }))
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: () => {},
        inputCb: () => {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver,
        initInputObserver: () => () => {}
      }
    )

    for (
      let index = 0;
      index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
      index += 1
    ) {
      expect(controller.addShadowRoot(createFakeShadowRoot(index))).toBeTrue()
    }
    expect(
      controller.addShadowRoot(
        createFakeShadowRoot(SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT)
      )
    ).toBeNull()
    expect(startMutationObserver).toHaveBeenCalledTimes(
      SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT
    )

    controller.stop()
    cleanupScheduler.drain()
  })

  it('should synchronously disconnect a retired generation when the cleanup queue is full', () => {
    const cleanupScheduler = createCleanupScheduler()
    const stopMutationObserver = jasmine.createSpy('stopMutationObserver')
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: () => {},
        inputCb: () => {},
        scheduleCleanup: cleanupScheduler.schedule,
        startMutationObserver: () => ({
          deactivate: () => {},
          flush: () => true,
          stop: stopMutationObserver
        }),
        initInputObserver: () => () => {}
      }
    )
    const queuedGenerationCount =
      SHADOW_ROOT_RETIRED_CONTROLLER_LIMIT /
      SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT

    for (
      let generation = 0;
      generation <= queuedGenerationCount;
      generation += 1
    ) {
      for (
        let index = 0;
        index < SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT;
        index += 1
      ) {
        expect(
          controller.addShadowRoot(
            createFakeShadowRoot(
              generation * SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT + index
            )
          )
        ).toBeTrue()
      }
      controller.reset()
    }

    expect(stopMutationObserver).toHaveBeenCalledTimes(
      SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT
    )
    cleanupScheduler.drain()
    expect(stopMutationObserver).toHaveBeenCalledTimes(
      (queuedGenerationCount + 1) *
        SHADOW_ROOT_ACTIVE_CONTROLLER_LIMIT
    )
    controller.stop()
  })
})

function createFakeShadowRoot(index) {
  return {
    host: {
      isConnected: true
    },
    index
  }
}

function createStubbedController(options) {
  return initShadowRootsController(
    {},
    {
      mutationCb: function () {},
      inputCb: function () {},
      scheduleCleanup: options.scheduleCleanup,
      startMutationObserver: function () {
        return {
          flush: function () {
            return true
          },
          stop: function () {}
        }
      },
      initInputObserver: function () {
        return function () {}
      }
    }
  )
}

function createCleanupScheduler() {
  const callbacks = []
  let callbackHead = 0
  let totalScheduled = 0
  return {
    schedule: function (callback) {
      callbacks.push(callback)
      totalScheduled += 1
    },
    runNext: function () {
      if (callbackHead >= callbacks.length) {
        return false
      }
      const callback = callbacks[callbackHead]
      callbacks[callbackHead] = undefined
      callbackHead += 1
      callback()
      return true
    },
    drain: function () {
      let runCount = 0
      while (this.runNext()) {
        runCount += 1
        if (runCount > 10000) {
          throw new Error('cleanup scheduler did not drain')
        }
      }
    },
    pendingCount: function () {
      return callbacks.length - callbackHead
    },
    scheduledCount: function () {
      return totalScheduled
    }
  }
}
