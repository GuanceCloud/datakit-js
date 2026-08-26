import {
  forEachChildNodes,
  getParentElement,
  getParentNode,
  hasChildNodes,
  isCommentNode,
  isElementNode,
  isNodeShadowHost,
  isNodeShadowRoot,
  isTextNode
} from './htmlDomUtils'

describe('htmlDomUtils', () => {
  it('should detect node kinds', () => {
    const element = document.createElement('div')
    const text = document.createTextNode('text')
    const comment = document.createComment('comment')

    expect(isElementNode(element)).toBeTrue()
    expect(isTextNode(text)).toBeTrue()
    expect(isCommentNode(comment)).toBeTrue()
  })

  it('should support shadow DOM helpers', () => {
    const host = document.createElement('div')
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const child = document.createElement('span')
    shadowRoot.appendChild(child)

    expect(isNodeShadowHost(host)).toBeTrue()
    expect(isNodeShadowRoot(shadowRoot)).toBeTrue()
    expect(hasChildNodes(host)).toBeTrue()
    expect(getParentNode(shadowRoot)).toBe(host)
    expect(getParentNode(child)).toBe(shadowRoot)
    expect(getParentElement(child)).toBe(host)
  })

  it('should iterate child nodes and include the shadow root', () => {
    const host = document.createElement('div')
    const text = document.createTextNode('hello')
    const element = document.createElement('span')
    host.appendChild(text)
    host.appendChild(element)
    const shadowRoot = host.attachShadow({ mode: 'open' })

    const children = []
    forEachChildNodes(host, (node) => {
      children.push(node)
    })

    expect(children).toEqual([text, element, shadowRoot])
  })
})
