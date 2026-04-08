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

  it('should use priority attributes like value and aria-label before text fallback', () => {
    const input = document.createElement('input')
    input.setAttribute('type', 'submit')
    input.value = 'Pay now'

    const region = document.createElement('div')
    region.setAttribute('aria-label', 'Close panel')
    region.innerText = 'Ignored text'

    expect(getActionNameFromElement(input)).toBe('Pay now')
    expect(getActionNameFromElement(region)).toBe('Close panel')
  })

  it('should fall back to placeholder and truncate long names', () => {
    const input = document.createElement('input')
    input.setAttribute('placeholder', 'Email Address')

    const longTextButton = document.createElement('button')
    longTextButton.innerText = 'A'.repeat(120)

    expect(getActionNameFromElement(input)).toBe('Email Address')
    expect(getActionNameFromElement(longTextButton)).toBe(
      'A'.repeat(100) + ' [...]'
    )
  })

  it('should not use textual fallback for contenteditable elements', () => {
    const editable = document.createElement('div')
    editable.contentEditable = 'true'
    editable.innerText = 'Editable text'

    expect(getActionNameFromElement(editable)).toBe('')
  })

  it('should stop looking past the nearest form boundary', () => {
    const outer = document.createElement('div')
    outer.innerText = 'Outer container'
    const form = document.createElement('form')
    const field = document.createElement('input')
    form.appendChild(field)
    outer.appendChild(form)

    expect(getActionNameFromElement(field)).toBe('')
  })

  it('should use select option text, alt and title strategies', () => {
    const select = document.createElement('select')
    const option = document.createElement('option')
    option.innerText = 'First Option'
    select.appendChild(option)

    const image = document.createElement('img')
    image.setAttribute('alt', 'Product image')

    const titled = document.createElement('div')
    titled.setAttribute('title', 'Tooltip action')

    expect(getActionNameFromElement(select)).toBe('First Option')
    expect(getActionNameFromElement(image)).toBe('Product image')
    expect(getActionNameFromElement(titled)).toBe('Tooltip action')
  })

  it('should trim and normalize whitespace in discovered names', () => {
    const wrapper = document.createElement('div')
    wrapper.setAttribute(DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE, '  Save   Changes  ')

    const button = document.createElement('button')
    button.innerText = '  Save \n  Changes  '
    wrapper.appendChild(button)

    expect(getActionNameFromElement(button)).toBe('Save Changes')
  })
})
