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
  SERIALIZATION_MAX_ATTRIBUTE_COUNT,
  SERIALIZATION_MAX_APPROX_BYTES,
  SERIALIZATION_MAX_DEPTH,
  SERIALIZATION_MAX_MUTATION_SOURCE_LENGTH,
  SERIALIZATION_MAX_NODE_SOURCE_LENGTH,
  SERIALIZATION_MAX_STRING_LENGTH,
  createMutationSerializerTask,
  serializeAttribute,
  serializeDocument,
  serializeElementNode,
  serializeNodeWithId,
  serializeNodeWithIdForMutation
} from './serialize'
import { STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES } from './serializationUtils'

describe('replay/record/serialize', () => {
  let originalStyleSheetsDescriptor

  beforeEach(() => {
    originalStyleSheetsDescriptor = Object.getOwnPropertyDescriptor(
      document,
      'styleSheets'
    )
  })

  afterEach(() => {
    if (originalStyleSheetsDescriptor) {
      Object.defineProperty(document, 'styleSheets', originalStyleSheetsDescriptor)
    }
  })

  it('should mask sensitive attributes in mask privacy mode', () => {
    const image = document.createElement('img')
    image.setAttribute('src', 'https://example.com/image.png')
    image.setAttribute('srcset', 'small.png 1x, large.png 2x')
    image.setAttribute('onerror', 'alert(1)')
    image.setAttribute('title', 'secret')
    image.setAttribute('data-token', 'secret-token')

    const link = document.createElement('a')
    link.setAttribute('href', 'https://example.com/private')

    const iframe = document.createElement('iframe')
    iframe.setAttribute('srcdoc', '<p>secret html</p>')

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
    expect(
      serializeAttribute(iframe, NodePrivacyLevel.MASK, 'srcdoc', {})
    ).toBe(CENSORED_STRING_MARK)
  })

  it('should mask source media attributes in mask privacy mode', () => {
    const source = document.createElement('source')
    source.setAttribute('srcset', 'video-sd.mp4 1x, video-hd.mp4 2x')
    source.setAttribute('onerror', 'reportError()')

    expect(
      serializeAttribute(source, NodePrivacyLevel.MASK, 'srcset', {})
    ).toBe(CENSORED_IMG_MARK)
    expect(
      serializeAttribute(source, NodePrivacyLevel.MASK, 'onerror', {})
    ).toBeNull()
  })

  it('should censor alt and placeholder attributes in mask privacy mode', () => {
    const image = document.createElement('img')
    image.setAttribute('alt', 'secret alt')

    const input = document.createElement('input')
    input.setAttribute('placeholder', 'secret placeholder')

    expect(
      serializeAttribute(image, NodePrivacyLevel.MASK, 'alt', {})
    ).toBe(CENSORED_STRING_MARK)
    expect(
      serializeAttribute(input, NodePrivacyLevel.MASK, 'placeholder', {})
    ).toBe(CENSORED_STRING_MARK)
  })

  it('should preserve the privacy attribute value in mask privacy mode', () => {
    const element = document.createElement('div')
    element.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_HIDDEN)

    expect(
      serializeAttribute(element, NodePrivacyLevel.MASK, PRIVACY_ATTR_NAME, {})
    ).toBe(PRIVACY_ATTR_VALUE_HIDDEN)
  })

  it('should preserve stable attributes in mask privacy mode', () => {
    const element = document.createElement('div')
    element.setAttribute('data-testid', 'checkout-submit')

    expect(
      serializeAttribute(element, NodePrivacyLevel.MASK, 'data-testid', {})
    ).toBe('checkout-submit')
  })

  it('should preserve the configured action name attribute in mask privacy mode', () => {
    const element = document.createElement('div')
    element.setAttribute('data-action-name', 'open-checkout')

    expect(
      serializeAttribute(element, NodePrivacyLevel.MASK, 'data-action-name', {
        actionNameAttribute: 'data-action-name'
      })
    ).toBe('open-checkout')
  })

  it('should return null for direct hidden-privacy attribute access', () => {
    const element = document.createElement('div')
    element.setAttribute('title', 'hidden title')

    expect(
      serializeAttribute(element, NodePrivacyLevel.HIDDEN, 'title', {})
    ).toBeNull()
  })

  it('should sanitize long data urls', () => {
    const image = document.createElement('img')
    image.setAttribute('src', 'data:text/plain,' + 'a'.repeat(24050))

    expect(
      serializeAttribute(image, NodePrivacyLevel.ALLOW, 'src', {})
    ).toBe('data:text/plain,[...]')
  })

  it('should serialize hidden elements with size placeholders', () => {
    const element = document.createElement('div')
    element.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_HIDDEN)
    element.style.width = '120px'
    element.style.height = '45px'

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

  it('should not read layout when serializing hidden elements', () => {
    const element = document.createElement('div')
    element.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_HIDDEN)
    element.style.width = '80px'
    spyOn(element, 'getBoundingClientRect')

    const serializedNode = serializeElementNode(element, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(element.getBoundingClientRect).not.toHaveBeenCalled()
    expect(serializedNode.attributes).toEqual(
      jasmine.objectContaining({
        rr_width: '80px',
        [PRIVACY_ATTR_NAME]: PRIVACY_ATTR_VALUE_HIDDEN
      })
    )
    expect(serializedNode.attributes.rr_height).toBeUndefined()
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

  it('should serialize deep mutation subtrees without recursive stack growth', () => {
    const weakSetConstructor = spyOn(window, 'WeakSet').and.callThrough()
    const root = document.createElement('div')
    let current = root
    for (let i = 0; i < 900; i += 1) {
      const child = document.createElement('div')
      current.appendChild(child)
      current = child
    }

    const serializedNode = serializeNodeWithIdForMutation(root, {
      configuration: {},
      serializedNodeIds: new Set(),
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.Element,
        tagName: 'div',
        childNodes: [jasmine.any(Object)]
      })
    )

    let depth = 0
    let node = serializedNode
    while (node && node.childNodes && node.childNodes.length) {
      depth += 1
      node = node.childNodes[0]
    }
    expect(depth).toBe(900)
    expect(weakSetConstructor).not.toHaveBeenCalled()
  })

  it('should stop before a serialized root exceeds the bounded stringify watermark', () => {
    expect(SERIALIZATION_MAX_APPROX_BYTES).toBe(1024 * 1024)
    const root = document.createElement('div')
    for (let index = 0; index < 30; index += 1) {
      const child = document.createElement('span')
      child.setAttribute('data-payload', 'x'.repeat(100000))
      root.appendChild(child)
    }
    spyOn(performance, 'now').and.returnValue(0)

    const task = createMutationSerializerTask(root, {
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

    expect(
      task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)
    ).toBeFalse()
    expect(task.isMaxApproxBytesReached).toBeTrue()
  })

  it('should truncate a single serialized attribute without rejecting its node', () => {
    const root = document.createElement('div')
    root.setAttribute(
      'data-payload',
      'x'.repeat(SERIALIZATION_MAX_STRING_LENGTH + 1)
    )
    spyOn(performance, 'now').and.returnValue(0)

    const task = createMutationSerializerTask(root, {
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

    expect(
      task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)
    ).toBeTrue()
    expect(task.isMaxNodeComplexityReached).toBeFalsy()
    expect(
      task.serializedNode.attributes['data-payload'].length
    ).toBeLessThanOrEqual(SERIALIZATION_MAX_NODE_SOURCE_LENGTH)
    expect(
      task.serializedNode.attributes['data-payload'].endsWith('…')
    ).toBeTrue()
  })

  it('should serialize only the bounded prefix of a large attribute list', () => {
    const root = document.createElement('div')
    for (
      let index = 0;
      index < SERIALIZATION_MAX_ATTRIBUTE_COUNT + 1;
      index += 1
    ) {
      root.setAttribute(`data-${index}`, 'x')
    }

    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(task.serializedNode).not.toBeNull()
    expect(task.isMaxNodeComplexityReached).toBeFalsy()
    expect(task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)).toBeTrue()
    expect(Object.keys(task.serializedNode.attributes).length).toBe(
      SERIALIZATION_MAX_ATTRIBUTE_COUNT
    )
  })

  it('should reject a shadow-root baseline when its observer cannot be registered', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const task = createMutationSerializerTask(shadowRoot, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine
            .createSpy('addShadowRoot')
            .and.returnValue(false)
        }
      }
    })

    expect(task.serializedNode).toBeNull()
    expect(task.isMaxNodeComplexityReached).toBeTrue()
    expect(task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)).toBeFalse()
  })

  it('should serialize a shadow root when its controller defers bookkeeping', () => {
    spyOn(performance, 'now').and.returnValue(0)
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    shadowRoot.appendChild(document.createElement('span'))
    Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
      configurable: true,
      value: []
    })
    const task = createMutationSerializerTask(shadowRoot, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine
            .createSpy('addShadowRoot')
            .and.returnValue(null)
        }
      }
    })

    expect(
      task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)
    ).toBeTrue()
    expect(task.isMaxNodeComplexityReached).toBeFalsy()
    expect(task.serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.DocumentFragment,
        isShadowRoot: true,
        adoptedStyleSheets: undefined,
        childNodes: [
          jasmine.objectContaining({ tagName: 'span' })
        ]
      })
    )
  })

  it('should truncate one oversized child text node without stopping the task', () => {
    const root = document.createElement('div')
    root.appendChild(
      document.createTextNode(
        'x'.repeat(SERIALIZATION_MAX_NODE_SOURCE_LENGTH + 1)
      )
    )
    spyOn(performance, 'now').and.returnValue(0)

    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)).toBeTrue()
    expect(task.isMaxNodeComplexityReached).toBeFalsy()
    expect(task.processedNodeCount).toBe(2)
    expect(task.serializedNode.childNodes[0].textContent.length).toBe(
      SERIALIZATION_MAX_MUTATION_SOURCE_LENGTH
    )
    expect(
      task.serializedNode.childNodes[0].textContent.endsWith('…')
    ).toBeTrue()
  })

  it('should apply privacy before truncating oversized text', () => {
    const root = document.createElement('div')
    root.appendChild(
      document.createTextNode(
        'private-value '.repeat(SERIALIZATION_MAX_NODE_SOURCE_LENGTH)
      )
    )
    spyOn(performance, 'now').and.returnValue(0)

    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)).toBeTrue()
    const serializedText = task.serializedNode.childNodes[0].textContent
    expect(serializedText.length).toBeLessThanOrEqual(
      SERIALIZATION_MAX_MUTATION_SOURCE_LENGTH
    )
    expect(serializedText).not.toContain('private-value')
  })

  it('should report overflow when a partial task exactly reaches its byte watermark', () => {
    const root = document.createElement('div')
    root.appendChild(document.createElement('span'))
    spyOn(performance, 'now').and.returnValue(0)

    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })
    const rootOnlyApproxBytes = task.approxBytes

    expect(task.advance(1000, 50000, rootOnlyApproxBytes)).toBeFalse()
    expect(task.isMaxApproxBytesReached).toBeTrue()
    expect(task.processedNodeCount).toBe(1)

    // A completed root at exactly the same watermark remains valid.
    const leafTask = createMutationSerializerTask(
      document.createElement('div'),
      {
        configuration: {},
        parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
        serializationContext: {
          status: SerializationContextStatus.MUTATION,
          shadowRootsController: {
            addShadowRoot: jasmine.createSpy('addLeafShadowRoot')
          }
        }
      }
    )
    expect(
      leafTask.advance(1000, 50000, leafTask.approxBytes)
    ).toBeTrue()
    expect(leafTask.isMaxApproxBytesReached).toBeFalse()
  })

  it('should reject a deeply nested full document before JSON serialization can overflow the call stack', () => {
    const htmlDocument = document.implementation.createHTMLDocument('deep')
    let current = htmlDocument.body
    for (let depth = 0; depth < SERIALIZATION_MAX_DEPTH + 10; depth += 1) {
      const child = htmlDocument.createElement('div')
      current.appendChild(child)
      current = child
    }
    current.setAttribute('data-last-node', 'true')

    let serializedDocument
    expect(() => {
      serializedDocument = serializeDocument(
        htmlDocument,
        { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
        {
          status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
          elementsScrollPositions: new Map(),
          shadowRootsController: {
            addShadowRoot: jasmine.createSpy('addShadowRoot')
          }
        }
      )
    }).not.toThrow()

    expect(serializedDocument).toBeNull()
  })

  it('should serialize a full snapshot root with five thousand siblings', () => {
    const root = document.createElement('main')
    for (let index = 0; index < 5000; index += 1) {
      const child = document.createElement('span')
      child.setAttribute('data-index', String(index))
      root.appendChild(child)
    }

    const serializedNode = serializeNodeWithId(root, {
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

    expect(serializedNode.childNodes.length).toBe(5000)
    expect(serializedNode.childNodes[4999].attributes['data-index']).toBe(
      '4999'
    )
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
    Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
      configurable: true,
      value: [
        {
          cssRules: [{ cssText: 'span { color: red; }' }],
          disabled: true,
          media: ['screen']
        }
      ]
    })
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
        adoptedStyleSheets: [
          {
            cssRules: ['span { color: red; }'],
            disabled: true,
            media: ['screen']
          }
        ],
        childNodes: jasmine.any(Array)
      })
    )
  })

  it('should resume an adopted stylesheet after a full snapshot slice byte yield', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const cssText = '.pending-rule { color: rebeccapurple; }'
    Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
      configurable: true,
      value: [{ cssRules: [{ cssText }] }]
    })
    spyOn(performance, 'now').and.returnValue(0)
    const task = createMutationSerializerTask(shadowRoot, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine
            .createSpy('addShadowRoot')
            .and.returnValue(true)
        }
      }
    })

    const firstSliceMaxApproxBytes = task.approxBytes + 40
    expect(
      task.advance(Infinity, 50000, firstSliceMaxApproxBytes)
    ).toBeFalse()
    expect(task.isMaxApproxBytesReached).toBeTrue()
    expect(task.serializedNode.adoptedStyleSheets[0].cssRules).toEqual([])
    expect(
      task.serializedNode.adoptedStyleSheets[0].isTruncated
    ).toBeUndefined()

    expect(
      task.advance(Infinity, 50000, task.approxBytes + 1024)
    ).toBeTrue()
    expect(task.isMaxApproxBytesReached).toBeFalse()
    expect(task.serializedNode.adoptedStyleSheets[0].cssRules).toEqual([
      cssText
    ])
    expect(
      task.serializedNode.adoptedStyleSheets[0].isTruncated
    ).toBeUndefined()
  })

  it('should truncate an adopted stylesheet at the mutation byte hard limit', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
      configurable: true,
      value: [
        {
          cssRules: [
            { cssText: '.oversized-rule { color: rebeccapurple; }' }
          ]
        }
      ]
    })
    spyOn(performance, 'now').and.returnValue(0)
    const task = createMutationSerializerTask(shadowRoot, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine
            .createSpy('addShadowRoot')
            .and.returnValue(true)
        }
      }
    })

    expect(
      task.advance(Infinity, 50000, task.approxBytes + 56)
    ).toBeTrue()
    expect(task.isMaxApproxBytesReached).toBeFalse()
    expect(task.serializedNode.adoptedStyleSheets).toEqual([
      {
        cssRules: [],
        disabled: undefined,
        media: undefined,
        isTruncated: true
      }
    ])
  })

  it('should share one adopted stylesheet budget across shadow roots', () => {
    const root = document.createElement('div')
    const cssText = 'x'.repeat(
      Math.floor(STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES / 3)
    )
    for (let index = 0; index < 2; index += 1) {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      Object.defineProperty(shadowRoot, 'adoptedStyleSheets', {
        configurable: true,
        value: [{ cssRules: [{ cssText }] }]
      })
      root.appendChild(host)
    }
    spyOn(performance, 'now').and.returnValue(0)
    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine
            .createSpy('addShadowRoot')
            .and.returnValue(true)
        }
      }
    })

    expect(task.advance(1000, 50000, SERIALIZATION_MAX_APPROX_BYTES)).toBeTrue()
    const shadowNodes = []
    const visit = function (node) {
      if (node.isShadowRoot) {
        shadowNodes.push(node)
      }
      ;(node.childNodes || []).forEach(visit)
    }
    visit(task.serializedNode)
    const serializedSheets = [].concat.apply(
      [],
      shadowNodes.map((node) => node.adoptedStyleSheets || [])
    )
    const serializedCssLength = serializedSheets.reduce(
      (length, styleSheet) =>
        length +
        styleSheet.cssRules.reduce(
          (rulesLength, rule) => rulesLength + rule.length,
          0
        ),
      0
    )
    expect(serializedCssLength * 2).toBeLessThanOrEqual(
      STYLESHEET_SERIALIZATION_MAX_SNAPSHOT_BYTES
    )
    expect(
      serializedSheets.some((styleSheet) => styleSheet.isTruncated)
    ).toBeTrue()
  })

  it('should serialize regular document fragments without shadow metadata', () => {
    const fragment = document.createDocumentFragment()
    fragment.appendChild(document.createElement('span'))
    const addShadowRoot = jasmine.createSpy('addShadowRoot')

    const serializedNode = serializeNodeWithId(fragment, {
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

    expect(addShadowRoot).not.toHaveBeenCalled()
    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.DocumentFragment,
        isShadowRoot: false,
        adoptedStyleSheets: undefined,
        childNodes: jasmine.any(Array)
      })
    )
  })

  it('should serialize document type nodes', () => {
    const documentType = document.implementation.createDocumentType(
      'html',
      '-//W3C//DTD XHTML 1.0 Transitional//EN',
      'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd'
    )

    const serializedNode = serializeNodeWithId(documentType, {
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

    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.DocumentType,
        name: 'html',
        publicId: '-//W3C//DTD XHTML 1.0 Transitional//EN',
        systemId: 'http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd'
      })
    )
  })

  it('should serialize cdata nodes as empty cdata payloads', () => {
    const xmlDocument = document.implementation.createDocument('', 'root', null)
    const cdata = xmlDocument.createCDATASection('secret content')

    const serializedNode = serializeNodeWithId(cdata, {
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

    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.CDATA,
        textContent: ''
      })
    )
  })

  it('should serialize document nodes through the public serializeDocument entry', () => {
    const htmlDocument = document.implementation.createHTMLDocument('test')
    Object.defineProperty(htmlDocument, 'adoptedStyleSheets', {
      configurable: true,
      value: [
        {
          cssRules: [{ cssText: 'body { background: white; }' }],
          disabled: false,
          media: []
        }
      ]
    })

    const serializedNode = serializeDocument(
      htmlDocument,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    )

    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.Document,
        adoptedStyleSheets: [
          {
            cssRules: ['body { background: white; }'],
            disabled: undefined,
            media: undefined
          }
        ],
        childNodes: jasmine.any(Array)
      })
    )
  })

  it('should serialize wide mutation subtrees across multiple time slices', () => {
    const root = document.createElement('div')
    for (let index = 0; index < 100; index += 1) {
      const child = document.createElement('span')
      child.setAttribute('data-index', String(index))
      root.appendChild(child)
    }
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now++)

    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(task.advance(4)).toBeFalse()
    expect(task.serializedNode.childNodes.length).toBeGreaterThan(0)
    expect(task.serializedNode.childNodes.length).toBeLessThan(100)

    expect(task.advance(10000, 50000)).toBeTrue()
    expect(
      task.serializedNode.childNodes.map((child) => child.attributes['data-index'])
    ).toEqual(Array.from({ length: 100 }, (_, index) => String(index)))
  })

  it('should skip a cached child removed between mutation serialization slices without truncating later siblings', () => {
    const root = document.createElement('div')
    for (let index = 0; index < 10; index += 1) {
      const child = document.createElement('span')
      child.setAttribute('data-index', String(index))
      root.appendChild(child)
    }
    let now = 0
    spyOn(performance, 'now').and.callFake(() => now++)

    const task = createMutationSerializerTask(root, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.ALLOW,
      serializationContext: {
        status: SerializationContextStatus.MUTATION,
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(task.advance(4)).toBeFalse()
    const removedChild = root.children[4]
    root.removeChild(removedChild)

    expect(task.advance(10000, 50000)).toBeTrue()
    expect(
      task.serializedNode.childNodes.map((child) => child.attributes['data-index'])
    ).toEqual(['0', '1', '2', '3', '5', '6', '7', '8', '9'])
  })

  it('should censor script text nodes during serialization', () => {
    const script = document.createElement('script')
    script.textContent = 'window.__secret__ = true;'
    document.body.appendChild(script)
    const textNode = script.firstChild

    const serializedNode = serializeNodeWithId(textNode, {
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

    expect(serializedNode).toEqual(
      jasmine.objectContaining({
        type: NodeType.Text,
        textContent: CENSORED_STRING_MARK
      })
    )
    script.remove()
  })

  it('should ignore whitespace-only text nodes inside head elements', () => {
    const head = document.createElement('head')
    head.appendChild(document.createTextNode('   \n  '))

    const serializedNode = serializeElementNode(head, {
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

    expect(serializedNode.childNodes).toEqual([])
  })

  it('should serialize linked stylesheet content from the matching href', () => {
    const link = document.createElement('link')
    link.href = 'https://example.com/app.css'

    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [
        {
          href: 'https://example.com/app.css',
          cssRules: [{ cssText: 'body { color: red; }' }]
        }
      ]
    })

    const serializedNode = serializeElementNode(link, {
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

    expect(serializedNode.attributes._cssText).toContain('color: red')
  })

  it('should not serialize css text when no stylesheet matches the link href', () => {
    const link = document.createElement('link')
    link.href = 'https://example.com/app.css'

    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [
        {
          href: 'https://example.com/other.css',
          cssRules: [{ cssText: 'body { color: blue; }' }]
        }
      ]
    })

    const serializedNode = serializeElementNode(link, {
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

    expect(serializedNode.attributes._cssText).toBeUndefined()
    expect(serializedNode.attributes.href).toBe(
      'https://example.com/app.css'
    )
  })

  it('should keep the href fallback for an incomplete linked stylesheet', () => {
    const link = document.createElement('link')
    link.href = 'https://example.com/large.css'
    Object.defineProperty(document, 'styleSheets', {
      configurable: true,
      value: [
        {
          href: 'https://example.com/large.css',
          cssRules: [
            { cssText: 'body { color: red; }' },
            { cssText: 'x'.repeat(SERIALIZATION_MAX_STRING_LENGTH) }
          ]
        }
      ]
    })

    const serializedNode = serializeElementNode(link, {
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

    expect(serializedNode.attributes.href).toBe(
      'https://example.com/large.css'
    )
    expect(serializedNode.attributes._cssText).toBeUndefined()
  })

  it('should serialize css text from style element sheets', () => {
    const style = document.createElement('style')
    Object.defineProperty(style, 'sheet', {
      configurable: true,
      value: {
        cssRules: [{ cssText: 'body { color: green; }' }]
      }
    })

    const serializedNode = serializeElementNode(style, {
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

    expect(serializedNode.attributes._cssText).toContain('color: green')
  })

  it('should retain bounded CSSOM text above the source-node limit', () => {
    const style = document.createElement('style')
    const cssText = 'x'.repeat(SERIALIZATION_MAX_NODE_SOURCE_LENGTH + 1)
    Object.defineProperty(style, 'sheet', {
      configurable: true,
      value: {
        cssRules: [{ cssText }]
      }
    })

    const serializedNode = serializeNodeWithId(style, {
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

    expect(serializedNode).not.toBeNull()
    expect(serializedNode.attributes._cssText).toBe(cssText)
  })

  it('should degrade an oversized style without failing the full serializer task', () => {
    const style = document.createElement('style')
    const cssText = 'x'.repeat(SERIALIZATION_MAX_STRING_LENGTH + 1)
    style.textContent = cssText
    Object.defineProperty(style, 'sheet', {
      configurable: true,
      value: {
        cssRules: [{ cssText }]
      }
    })

    const serializedNode = serializeNodeWithId(style, {
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

    expect(serializedNode).not.toBeNull()
    expect(serializedNode.attributes._cssText).toBeUndefined()
    expect(serializedNode.childNodes).toEqual([
      jasmine.objectContaining({
        type: NodeType.Text,
        textContent: jasmine.any(String)
      })
    ])
    expect(serializedNode.childNodes[0].textContent.length).toBe(
      SERIALIZATION_MAX_NODE_SOURCE_LENGTH
    )
    expect(serializedNode.childNodes[0].textContent.endsWith('…')).toBeTrue()
  })

  it('should retain inline style text when CSSOM serialization is incomplete', () => {
    const style = document.createElement('style')
    style.textContent = 'body { color: green; }'
    Object.defineProperty(style, 'sheet', {
      configurable: true,
      value: {
        cssRules: [
          { cssText: 'body { color: red; }' },
          { cssText: 'x'.repeat(SERIALIZATION_MAX_STRING_LENGTH) }
        ]
      }
    })

    const serializedNode = serializeNodeWithId(style, {
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

    expect(serializedNode.attributes._cssText).toBeUndefined()
    expect(serializedNode.childNodes).toEqual([
      jasmine.objectContaining({
        type: NodeType.Text,
        textContent: 'body { color: green; }'
      })
    ])
  })

  it('should serialize media playback state for video elements', () => {
    const video = document.createElement('video')
    Object.defineProperty(video, 'paused', {
      configurable: true,
      get() {
        return false
      }
    })

    const serializedNode = serializeElementNode(video, {
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

    expect(serializedNode.attributes.rr_mediaState).toBe('played')
  })

  it('should serialize paused media state for audio elements', () => {
    const audio = document.createElement('audio')
    Object.defineProperty(audio, 'paused', {
      configurable: true,
      get() {
        return true
      }
    })

    const serializedNode = serializeElementNode(audio, {
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

    expect(serializedNode.attributes.rr_mediaState).toBe('paused')
  })

  it('should serialize selected option state in allow privacy mode', () => {
    const option = document.createElement('option')
    option.selected = true
    option.value = 'shanghai'

    const serializedNode = serializeElementNode(option, {
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

    expect(serializedNode.attributes.value).toBe('shanghai')
    expect(serializedNode.attributes.selected).toBeTrue()
  })

  it('should not add selected state for unselected options', () => {
    const option = document.createElement('option')
    option.selected = false
    option.value = 'beijing'

    const serializedNode = serializeElementNode(option, {
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

    expect(serializedNode.attributes.value).toBe('beijing')
    expect(serializedNode.attributes.selected).toBeUndefined()
  })

  it('should omit checked state for masked checkbox inputs', () => {
    const checkbox = document.createElement('input')
    checkbox.type = 'checkbox'
    checkbox.checked = true

    const serializedNode = serializeElementNode(checkbox, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe(CENSORED_STRING_MARK)
    expect(serializedNode.attributes.checked).toBeUndefined()
  })

  it('should preserve submit input values in mask-user-input mode', () => {
    const submit = document.createElement('input')
    submit.type = 'submit'
    submit.value = 'Send form'

    const serializedNode = serializeElementNode(submit, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe('Send form')
  })

  it('should preserve range input values in mask-user-input mode', () => {
    const range = document.createElement('input')
    range.type = 'range'
    range.value = '42'

    const serializedNode = serializeElementNode(range, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe('42')
  })

  it('should preserve button input values in mask-user-input mode', () => {
    const button = document.createElement('input')
    button.type = 'button'
    button.value = 'Open panel'

    const serializedNode = serializeElementNode(button, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe('Open panel')
  })

  it('should preserve reset input values in mask-user-input mode', () => {
    const reset = document.createElement('input')
    reset.type = 'reset'
    reset.value = 'Reset form'

    const serializedNode = serializeElementNode(reset, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe('Reset form')
  })

  it('should mask select values in mask-user-input mode', () => {
    const select = document.createElement('select')
    const option = document.createElement('option')
    option.value = 'shanghai'
    option.textContent = 'Shanghai'
    select.appendChild(option)
    select.value = 'shanghai'

    const serializedNode = serializeElementNode(select, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe(CENSORED_STRING_MARK)
  })

  it('should mask textarea values in mask-user-input mode', () => {
    const textarea = document.createElement('textarea')
    textarea.value = 'secret note'

    const serializedNode = serializeElementNode(textarea, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe(CENSORED_STRING_MARK)
  })

  it('should preserve select values in allow privacy mode', () => {
    const select = document.createElement('select')
    const option = document.createElement('option')
    option.value = 'beijing'
    option.textContent = 'Beijing'
    select.appendChild(option)
    select.value = 'beijing'

    const serializedNode = serializeElementNode(select, {
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

    expect(serializedNode.attributes.value).toBe('beijing')
  })

  it('should preserve option values but omit selected state in mask-user-input mode', () => {
    const option = document.createElement('option')
    option.value = 'secret-option'
    option.selected = true

    const serializedNode = serializeElementNode(option, {
      configuration: {},
      parentNodePrivacyLevel: NodePrivacyLevel.MASK_USER_INPUT,
      serializationContext: {
        status: SerializationContextStatus.INITIAL_FULL_SNAPSHOT,
        elementsScrollPositions: new Map(),
        shadowRootsController: {
          addShadowRoot: jasmine.createSpy('addShadowRoot')
        }
      }
    })

    expect(serializedNode.attributes.value).toBe('secret-option')
    expect(serializedNode.attributes.selected).toBeUndefined()
  })

  it('should serialize false checked state for unchecked radio inputs', () => {
    const radio = document.createElement('input')
    radio.type = 'radio'
    radio.checked = false

    const serializedNode = serializeElementNode(radio, {
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

    expect(serializedNode.attributes.checked).toBeFalse()
  })

  it('should convert table background attributes to absolute urls', () => {
    const table = document.createElement('table')
    table.setAttribute('background', '/images/grid.png')

    const serializedNode = serializeElementNode(table, {
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

    expect(serializedNode.attributes.background).toContain('/images/grid.png')
  })

  it('should convert table cell background attributes to absolute urls', () => {
    const cell = document.createElement('td')
    cell.setAttribute('background', '/images/cell.png')

    const serializedNode = serializeElementNode(cell, {
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

    expect(serializedNode.attributes.background).toContain('/images/cell.png')
  })

  it('should convert table header background attributes to absolute urls', () => {
    const header = document.createElement('th')
    header.setAttribute('background', '/images/header.png')

    const serializedNode = serializeElementNode(header, {
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

    expect(serializedNode.attributes.background).toContain('/images/header.png')
  })

  it('should convert object data attributes to absolute urls', () => {
    const object = document.createElement('object')
    object.setAttribute('data', '/docs/guide.pdf')

    const serializedNode = serializeElementNode(object, {
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

    expect(serializedNode.attributes.data).toContain('/docs/guide.pdf')
  })

  it('should convert inline style urls to absolute urls', () => {
    const element = document.createElement('div')
    element.setAttribute(
      'style',
      "background-image: url('../img/card.png');"
    )

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

    expect(serializedNode.attributes.style).toContain('/img/card.png')
  })

  it('should convert anchor href attributes to absolute urls', () => {
    const link = document.createElement('a')
    link.setAttribute('href', '/docs/start')

    const serializedNode = serializeElementNode(link, {
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

    expect(serializedNode.attributes.href).toContain('/docs/start')
  })

  it('should convert image src attributes to absolute urls', () => {
    const image = document.createElement('img')
    image.setAttribute('src', '/assets/logo.png')

    const serializedNode = serializeElementNode(image, {
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

    expect(serializedNode.attributes.src).toContain('/assets/logo.png')
  })

  it('should convert source src attributes to absolute urls', () => {
    const source = document.createElement('source')
    source.setAttribute('src', '/video/stream.m3u8')

    const serializedNode = serializeElementNode(source, {
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

    expect(serializedNode.attributes.src).toContain('/video/stream.m3u8')
  })

  it('should convert image srcset attributes to absolute urls', () => {
    const image = document.createElement('img')
    image.setAttribute('srcset', '/img/small.png 1x, /img/large.png 2x')

    const serializedNode = serializeElementNode(image, {
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

    expect(serializedNode.attributes.srcset).toContain('/img/small.png 1x')
    expect(serializedNode.attributes.srcset).toContain('/img/large.png 2x')
  })

  it('should convert source srcset attributes to absolute urls', () => {
    const source = document.createElement('source')
    source.setAttribute('srcset', '/video/sd.mp4 1x, /video/hd.mp4 2x')

    const serializedNode = serializeElementNode(source, {
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

    expect(serializedNode.attributes.srcset).toContain('/video/sd.mp4 1x')
    expect(serializedNode.attributes.srcset).toContain('/video/hd.mp4 2x')
  })

  it('should keep fragment xlink:href values unchanged on svg use elements', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('xlink:href', '#icon-check')

    const serializedNode = serializeElementNode(use, {
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

    expect(serializedNode.attributes['xlink:href']).toBe('#icon-check')
  })

  it('should keep fragment href values unchanged on svg use elements', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', '#icon-check')

    const serializedNode = serializeElementNode(use, {
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

    expect(serializedNode.attributes.href).toBe('#icon-check')
  })

  it('should convert non-fragment href values to absolute urls on svg use elements', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('href', '/icons/sprite.svg#icon-check')

    const serializedNode = serializeElementNode(use, {
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

    expect(serializedNode.attributes.href).toContain('/icons/sprite.svg#icon-check')
  })

  it('should convert non-fragment xlink:href values to absolute urls', () => {
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use')
    use.setAttribute('xlink:href', '/icons/sprite.svg#icon-check')

    const serializedNode = serializeElementNode(use, {
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

    expect(serializedNode.attributes['xlink:href']).toContain(
      '/icons/sprite.svg#icon-check'
    )
  })

  it('should not serialize child text nodes for style elements', () => {
    const style = document.createElement('style')
    style.textContent = 'body { color: red; }'

    const serializedNode = serializeElementNode(style, {
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

    expect(serializedNode.childNodes).toEqual([])
  })

  it('should retain style text when CSSOM serialization is unavailable', () => {
    const style = document.createElement('style')
    style.textContent = 'body { color: red; }'
    Object.defineProperty(style, 'sheet', {
      configurable: true,
      value: {}
    })

    const serializedNode = serializeNodeWithId(style, {
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

    expect(serializedNode.attributes._cssText).toBeUndefined()
    expect(serializedNode.childNodes).toEqual([
      jasmine.objectContaining({
        type: NodeType.Text,
        textContent: 'body { color: red; }'
      })
    ])
  })

  it('should fall back to div for invalid tag names', () => {
    const element = document.createElement('div')
    spyOnProperty(element, 'tagName', 'get').and.returnValue('bad tag!')

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

    expect(serializedNode.tagName).toBe('div')
  })
})
