import {
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

  it('should expose scope selector support as a boolean', () => {
    expect(typeof supportScopeSelector()).toBe('boolean')
  })
})
