import {
  CENSORED_IMG_MARK,
  CENSORED_STRING_MARK,
  NodePrivacyLevel,
  PRIVACY_ATTR_NAME,
  PRIVACY_ATTR_VALUE_HIDDEN
} from '../../../constants'
import { NodeType } from '../../../types'
import {
  SerializationContextStatus,
  serializeAttribute,
  serializeElementNode,
  serializeNodeWithId
} from './serialize'

describe('replay/record/serialize', () => {
  it('should mask sensitive attributes in mask privacy mode', () => {
    const image = document.createElement('img')
    image.setAttribute('src', 'https://example.com/image.png')
    image.setAttribute('srcset', 'small.png 1x, large.png 2x')
    image.setAttribute('onerror', 'alert(1)')
    image.setAttribute('title', 'secret')
    image.setAttribute('data-token', 'secret-token')

    const link = document.createElement('a')
    link.setAttribute('href', 'https://example.com/private')

    expect(
      serializeAttribute(image, NodePrivacyLevel.MASK, 'src', {})
    ).toBe(CENSORED_IMG_MARK)
    expect(
      serializeAttribute(image, NodePrivacyLevel.MASK, 'srcset', {})
    ).toBe(CENSORED_IMG_MARK)
    expect(
      serializeAttribute(image, NodePrivacyLevel.MASK, 'onerror', {})
    ).toBeNull()
    expect(
      serializeAttribute(image, NodePrivacyLevel.MASK, 'title', {})
    ).toBe(CENSORED_STRING_MARK)
    expect(
      serializeAttribute(image, NodePrivacyLevel.MASK, 'data-token', {})
    ).toBe(CENSORED_STRING_MARK)
    expect(
      serializeAttribute(link, NodePrivacyLevel.MASK, 'href', {})
    ).toBe(CENSORED_STRING_MARK)
  })

  it('should serialize hidden elements with size placeholders', () => {
    const element = document.createElement('div')
    element.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_HIDDEN)
    spyOn(element, 'getBoundingClientRect').and.returnValue({
      width: 120,
      height: 45
    })

    const serializedNode = serializeElementNode(element, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode).toEqual({
      type: NodeType.Element,
      tagName: 'div',
      attributes: {
        rr_width: '120px',
        rr_height: '45px',
        [PRIVACY_ATTR_NAME]: PRIVACY_ATTR_VALUE_HIDDEN
      },
      childNodes: [],
      isSVG: undefined
    })
  })

  it('should reuse node ids and track serialized ids', () => {
    const element = document.createElement('div')
    const serializedNodeIds = new Set()
    const options = {
      configuration: {},
      serializedNodeIds,
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    }

    const firstSerializedNode = serializeNodeWithId(element, options)
    const secondSerializedNode = serializeNodeWithId(element, options)

    expect(firstSerializedNode.id).toBe(secondSerializedNode.id)
    expect(serializedNodeIds.has(firstSerializedNode.id)).toBeTrue()
  })

  it('should serialize element runtime state during initial full snapshots', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true
    const scrollable = document.createElement('div')
    Object.defineProperty(scrollable, 'scrollLeft', {
      configurable: true,
      value: 7
    })
    Object.defineProperty(scrollable, 'scrollTop', {
      configurable: true,
      value: 11
    })

    const scrollPositions = new Map()
    const serializedCheckbox = serializeElementNode(checkbox, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: scrollPositions,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })
    const serializedScrollable = serializeElementNode(scrollable, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: scrollPositions,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedCheckbox.attributes.checked).toBeTrue()
    expect(serializedScrollable.attributes.rr_scrollLeft).toBe(7)
    expect(serializedScrollable.attributes.rr_scrollTop).toBe(11)
    expect(scrollPositions.get(scrollable)).toEqual({
      scrollTop: 11,
      scrollLeft: 7
    })
  })

  it('should reuse cached scroll positions during subsequent full snapshots', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'hello'
    const scrollPositions = new Map()
    scrollPositions.set(textarea, {
      scrollTop: 15,
      scrollLeft: 5
    })

    const serializedNode = serializeElementNode(textarea, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.SUBSEQUENT_FULL_SNAPSHOT,
        elementsScrollPositions: scrollPositions,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe('hello')
    expect(serializedNode.attributes.rr_scrollLeft).toBe(5)
    expect(serializedNode.attributes.rr_scrollTop).toBe(15)
  })

  it('should register shadow roots when serializing document fragments', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    shadowRoot.appendChild(document.createElement('span'))
    const addShadowRoot = jasmine.createSpy('addShadowRoot')

    const serializedNode = serializeNodeWithId(shadowRoot, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot
        }
      }
    })

    expect(addShadowRoot).toHaveBeenCalledWith(shadowRoot)
    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.DocumentFragment,
        isShadowRoot: true,
        childNodes: jasmine.any(Array)
      })
    )
  })
})
