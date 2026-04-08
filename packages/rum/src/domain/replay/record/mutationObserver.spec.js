import { NodePrivacyLevel } from '../../../constants'
import { startMutationObserver } from './mutationObserver'
import { setSerializedNodeId } from './serializationUtils'

describe('replay/record/mutationObserver', () => {
  let OriginalMutationObserver
  let observedCallback
  let observedTarget
  let disconnect

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
    Object.defineProperty(window, 'MutationObserver', {
      configurable: true,
      value: OriginalMutationObserver
    })
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
})
