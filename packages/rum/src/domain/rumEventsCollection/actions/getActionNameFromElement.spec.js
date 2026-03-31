import {
  DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE,
  getActionNameFromElement
} from './getActionNameFromElement'

describe('getActionNameFromElement', () => {
  it('should prefer programmatic action names from ancestors', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute(DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE, 'Checkout')
    const button = document.createElement('button')
    wrapper.appendChild(button)

    expect(getActionNameFromElement(button)).toBe('Checkout')
  })

  it('should resolve names from associated labels and aria-labelledby', () => {
    const root = document.createElement('div')

    const label = document.createElement('label')
    label.htmlFor = 'email-id'
    label.innerText = 'Email Address'
    root.appendChild(label)

    const input = document.createElement('input')
    input.id = 'email-id'
    root.appendChild(input)

    const caption = document.createElement('span')
    caption.id = 'caption-id'
    caption.innerText = 'Delete item'
    root.appendChild(caption)

    const iconButton = document.createElement('button')
    iconButton.setAttribute('aria-labelledby', 'caption-id')
    root.appendChild(iconButton)

    document.body.appendChild(root)

    expect(getActionNameFromElement(input)).toBe('Email Address')
    expect(getActionNameFromElement(iconButton)).toBe('Delete item')

    root.remove()
  })

  it('should support a custom programmatic action attribute', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute('data-action-name', 'Custom Checkout')
    const button = document.createElement('button')
    button.innerText = 'Ignored Text'
    wrapper.appendChild(button)

    expect(getActionNameFromElement(button, 'data-action-name')).toBe(
      'Custom Checkout'
    )
  })
})
