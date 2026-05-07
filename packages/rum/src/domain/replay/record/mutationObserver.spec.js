import { NodePrivacyLevel } from '../../../constants'
import { startMutationObserver } from './mutationObserver'
import { MUTATION_PROCESS_MIN_DELAY } from './mutationBatch'
import { setSerializedNodeId } from './serializationUtils'

describe('replay/record/mutationObserver', () => {
  let OriginalMutationObserver
  let originalRequestIdleCallback
  let originalCancelIdleCallback
  let observedCallback
  let observedTarget
  let disconnect
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
    observedCallback = undefined
    observedTarget = undefined

    function FakeMutationObserver(callback) {
      observedCallback = callback
      this.observe = jasmine.createSpy('observe').and.callFake((target) => {
        observedTarget = target
      })
      this.disconnect = disconnect
      this.takeRecords = jasmine.createSpy('takeRecords').and.returnValue([])
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

  it('should not overflow the call stack when serializing deep childList mutations', () => {
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
    const observer = startMutationObserver(
      mutationCallback,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      { removeShadowRoot: jasmine.createSpy('removeShadowRoot') },
      parent
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

    expect(mutationCallback).toHaveBeenCalled()
    expect(mutationCallback.calls.mostRecent().args[0].adds.length).toBe(1)
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

  it('should not emit a moved pending root twice when it is reparented under another pending root', () => {
    jasmine.clock().install()
    window.requestIdleCallback = undefined
    window.cancelIdleCallback = undefined

    const parent = document.createElement('div')
    const nextSibling = document.createElement('div')
    document.body.appendChild(parent)
    document.body.appendChild(nextSibling)
    setSerializedNodeId(parent, 610)
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

    expect(shadowRootsController.addShadowRoot).toHaveBeenCalledWith(shadowRoot)
    expect(mutationCallback.calls.mostRecent().args[0].adds.length).toBe(1)
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
