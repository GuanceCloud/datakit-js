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
    wrapper.setAttribute(
      DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE,
      '  Save   Changes  '
    )

    const button = document.createElement('button')
    button.innerText = '  Save \n  Changes  '
    wrapper.appendChild(button)

    expect(getActionNameFromElement(button)).toBe('Save Changes')
  })

  describe('shadow DOM support', () => {
    it('should extract text from an element inside a shadow root', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const button = document.createElement('button')
      button.innerText = 'Shadow Button'
      shadowRoot.appendChild(button)
      document.body.appendChild(host)

      expect(getActionNameFromElement(button)).toBe('Shadow Button')

      host.remove()
    })

    it('should find a programmatic action name across a shadow boundary', () => {
      const host = document.createElement('div')
      host.setAttribute(
        DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE,
        'Host Action'
      )
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const target = document.createElement('span')
      shadowRoot.appendChild(target)

      expect(getActionNameFromElement(target)).toBe('Host Action')
    })

    it('should resolve aria-labelledby inside the same shadow root', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const label = document.createElement('span')
      label.id = 'shadow-label'
      label.innerText = 'Save Data'
      const button = document.createElement('button')
      button.setAttribute('aria-labelledby', 'shadow-label')
      shadowRoot.appendChild(label)
      shadowRoot.appendChild(button)

      expect(getActionNameFromElement(button)).toBe('Save Data')
    })

    it('should only use semantic names for shadow DOM actions', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const row = document.createElement('div')
      const type = document.createElement('span')
      type.innerText = '对公付款'
      const amount = document.createElement('span')
      amount.innerText = '￥4,910.73'
      const documentNumber = document.createElement('span')
      documentNumber.innerText = 'DGFK2608240101'
      row.appendChild(type)
      row.appendChild(amount)
      row.appendChild(documentNumber)
      shadowRoot.appendChild(row)
      document.body.appendChild(host)

      expect(getActionNameFromElement(amount, undefined, true)).toBe('')

      host.remove()
    })

    it('should keep single-character native button text in shadow DOM', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const button = document.createElement('button')
      button.innerText = '思'
      shadowRoot.appendChild(button)
      document.body.appendChild(host)

      expect(getActionNameFromElement(button, undefined, true)).toBe('思')

      host.remove()
    })

    it('should preserve aria labels on complex shadow DOM controls', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const button = document.createElement('button')
      button.setAttribute('aria-label', '关闭付款单')
      const decorations = ['icon', 'label', 'spinner']
      decorations.forEach((className) => {
        const decoration = document.createElement('span')
        decoration.className = className
        button.appendChild(decoration)
      })
      shadowRoot.appendChild(button)
      document.body.appendChild(host)

      expect(getActionNameFromElement(button, undefined, true)).toBe(
        '关闭付款单'
      )

      host.remove()
    })

    it('should keep semantic link text for shadow DOM actions', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const link = document.createElement('a')
      link.href = '#payment'
      const label = document.createElement('span')
      label.innerText = '查看付款详情'
      link.appendChild(label)
      shadowRoot.appendChild(link)
      document.body.appendChild(host)

      expect(getActionNameFromElement(label, undefined, true)).toBe(
        '查看付款详情'
      )

      host.remove()
    })

    it('should preserve programmatic names on non-semantic shadow DOM containers', () => {
      const host = document.createElement('div')
      const shadowRoot = host.attachShadow({ mode: 'open' })
      const card = document.createElement('div')
      card.setAttribute(
        DEFAULT_PROGRAMMATIC_ACTION_NAME_ATTRIBUTE,
        '打开付款单'
      )
      const amount = document.createElement('span')
      amount.innerText = '￥4,910.73'
      card.appendChild(amount)
      shadowRoot.appendChild(card)

      expect(getActionNameFromElement(amount, undefined, true)).toBe(
        '打开付款单'
      )
    })

    it('should keep the existing textual fallback for normal DOM actions', () => {
      const target = document.createElement('span')
      target.innerText = '思'

      expect(getActionNameFromElement(target)).toBe('思')
    })

    it('should keep the existing link naming order for normal DOM actions', () => {
      const link = document.createElement('a')
      link.href = '#payment'
      const label = document.createElement('span')
      label.innerText = '查看付款'
      const badge = document.createElement('span')
      badge.innerText = '附加信息'
      link.appendChild(label)
      link.appendChild(badge)
      document.body.appendChild(link)

      expect(getActionNameFromElement(label)).toBe('查看付款')
      expect(getActionNameFromElement(label, undefined, true)).toBe(
        '查看付款附加信息'
      )

      link.remove()
    })
  })
})
