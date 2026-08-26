import {
  SHADOW_DOM_MARKER,
  STABLE_ATTRIBUTES,
  getSelectorFromElement,
  supportScopeSelector
} from './getSelectorsFromElement'

describe('getSelectorsFromElement', () => {
  it('should return undefined for detached elements', () => {
    expect(getSelectorFromElement(document.createElement('button'))).toBeUndefined()
  })

  it('should prefer stable attributes and ids when globally unique', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.setAttribute(STABLE_ATTRIBUTES[0], 'Checkout')
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button)).toBe(
      'BUTTON[' + STABLE_ATTRIBUTES[0] + '="Checkout"]'
    )

    button.removeAttribute(STABLE_ATTRIBUTES[0])
    button.id = 'checkoutButton'
    expect(getSelectorFromElement(button)).toBe('#checkoutButton')

    root.remove()
  })

  it('should combine ancestor and nth-of-type selectors when needed', () => {
    const root = document.createElement('div')
    root.setAttribute('data-testid', 'container')
    const first = document.createElement('span')
    const second = document.createElement('span')
    root.appendChild(first)
    root.appendChild(second)
    document.body.appendChild(root)

    expect(getSelectorFromElement(second)).toBe(
      'DIV[data-testid="container"]>SPAN:nth-of-type(2)'
    )

    root.remove()
  })

  it('should ignore generated ids and fall back to a stable class selector', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.id = 'checkout-123'
    button.className = 'checkout-button'
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button)).toBe('BODY>DIV>BUTTON.checkout-button')

    root.remove()
  })

  it('should ignore generated class names and use a stable ancestor selector', () => {
    const root = document.createElement('section')
    root.setAttribute('data-testid', 'checkout-section')
    const button = document.createElement('button')
    button.className = 'btn-1234'
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button)).toBe(
      'SECTION[data-testid="checkout-section"]>BUTTON'
    )

    root.remove()
  })

  it('should prefer a custom action name attribute when provided', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.setAttribute('data-dd-action-name', 'PayNow')
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button, 'data-dd-action-name')).toBe(
      'BUTTON[data-dd-action-name="PayNow"]'
    )

    root.remove()
  })

  it('should escape globally unique ids when building selectors', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.id = 'checkout:button'
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button)).toBe('#checkout\\:button')

    root.remove()
  })

  it('should fall back to nth-of-type when siblings share the same stable selector', () => {
    const root = document.createElement('div')
    root.setAttribute('data-testid', 'list')
    const first = document.createElement('button')
    const second = document.createElement('button')
    first.className = 'cta'
    second.className = 'cta'
    root.appendChild(first)
    root.appendChild(second)
    document.body.appendChild(root)

    expect(getSelectorFromElement(second)).toBe(
      'DIV[data-testid="list"]>BUTTON:nth-of-type(2)'
    )

    root.remove()
  })

  it('should expose scope selector support as a boolean', () => {
    expect(typeof supportScopeSelector()).toBe('boolean')
  })

  it('should escape stable attribute values when generating selectors', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'Checkout "Now"')
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button)).toBe(
      'BUTTON[data-testid="Checkout\\ \\"Now\\""]'
    )

    root.remove()
  })

  it('should use the ownerDocument contains fallback when isConnected is unavailable', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'connected-button')
    root.appendChild(button)
    document.body.appendChild(root)

    const originalIsConnected = button.isConnected
    delete button.isConnected

    expect(getSelectorFromElement(button)).toBe(
      'BUTTON[data-testid="connected-button"]'
    )

    Object.defineProperty(button, 'isConnected', {
      configurable: true,
      value: originalIsConnected
    })
    root.remove()
  })

  it('should not use body class selectors and should fall back to tag composition', () => {
    const button = document.createElement('button')
    document.body.className = 'page-shell'
    document.body.appendChild(button)

    expect(getSelectorFromElement(button)).toBe('BODY>BUTTON')

    button.remove()
    document.body.className = ''
  })

  it('should skip generated classes and use the next stable class name', () => {
    const root = document.createElement('div')
    const button = document.createElement('button')
    button.className = 'btn-123 stable-class'
    root.appendChild(button)
    document.body.appendChild(root)

    expect(getSelectorFromElement(button)).toBe('BODY>DIV>BUTTON.stable-class')

    root.remove()
  })

  it('should generate a selector across a shadow root boundary', () => {
    const host = document.createElement('div')
    host.id = 'shadow-host'
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.className = 'shadow-button'
    shadowRoot.appendChild(button)
    document.body.appendChild(host)

    expect(getSelectorFromElement(button)).toBe(
      '#shadow-host' + SHADOW_DOM_MARKER + 'BUTTON.shadow-button'
    )

    host.remove()
  })

  it('should generate selectors across nested shadow roots', () => {
    const outerHost = document.createElement('div')
    outerHost.setAttribute('data-testid', 'outer-host')
    const outerRoot = outerHost.attachShadow({ mode: 'open' })
    const innerHost = document.createElement('section')
    innerHost.setAttribute('data-testid', 'inner-host')
    outerRoot.appendChild(innerHost)
    const innerRoot = innerHost.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.setAttribute('data-testid', 'deep-button')
    innerRoot.appendChild(button)
    document.body.appendChild(outerHost)

    expect(getSelectorFromElement(button)).toBe(
      'DIV[data-testid="outer-host"]' +
        SHADOW_DOM_MARKER +
        'SECTION[data-testid="inner-host"]' +
        SHADOW_DOM_MARKER +
        'BUTTON[data-testid="deep-button"]'
    )

    outerHost.remove()
  })

  it('should distinguish identical elements in sibling shadow hosts', () => {
    const container = document.createElement('div')
    container.id = 'shadow-container'
    const firstHost = document.createElement('action-host')
    const secondHost = document.createElement('action-host')
    container.appendChild(firstHost)
    container.appendChild(secondHost)
    const firstButton = document.createElement('button')
    const secondButton = document.createElement('button')
    firstHost.attachShadow({ mode: 'open' }).appendChild(firstButton)
    secondHost.attachShadow({ mode: 'open' }).appendChild(secondButton)
    document.body.appendChild(container)

    expect(getSelectorFromElement(firstButton)).toBe(
      '#shadow-container>ACTION-HOST:nth-of-type(1)' +
        SHADOW_DOM_MARKER +
        'BUTTON'
    )
    expect(getSelectorFromElement(secondButton)).toBe(
      '#shadow-container>ACTION-HOST:nth-of-type(2)' +
        SHADOW_DOM_MARKER +
        'BUTTON'
    )

    container.remove()
  })
})
