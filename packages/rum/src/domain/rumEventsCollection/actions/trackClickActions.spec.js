import {
  FrustrationType,
  LifeCycle,
  LifeCycleEventType,
  Observable
} from '@cloudcare/browser-core'
import { finalizeClicks, trackClickActions } from './trackClickActions'

function createClick(overrides) {
  const frustrations = []
  const click = {
    event: {
      timeStamp: 0,
      target: document.createElement('button')
    },
    stop: jasmine.createSpy('stop'),
    validate: jasmine.createSpy('validate'),
    discard: jasmine.createSpy('discard'),
    addFrustration(type) {
      frustrations.push(type)
    },
    hasError: () => false,
    hasPageActivity: () => false,
    getUserActivity: () => ({
      selection: false,
      scroll: false,
      input: false
    })
  }

  Object.assign(click, overrides)
  click.frustrations = frustrations
  return click
}

describe('trackClickActions', () => {
  it('should use the actual shadow DOM target to compute the action name', () => {
    jasmine.clock().install()
    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const actions = []
    const host = document.createElement('div')
    host.id = 'shadow-host'
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const button = document.createElement('button')
    button.innerText = '应付凭证'
    shadowRoot.appendChild(button)
    document.body.appendChild(host)

    const collection = trackClickActions(lifeCycle, domMutationObservable, {
      excludedActivityUrls: []
    })
    lifeCycle.subscribe(LifeCycleEventType.AUTO_ACTION_COMPLETED, (action) => {
      actions.push(action)
    })

    function dispatchPointerEvent(type) {
      const event = new Event(type, {
        bubbles: true,
        composed: true
      })
      Object.assign(event, {
        isPrimary: true,
        clientX: 0,
        clientY: 0
      })
      button.dispatchEvent(event)
    }

    try {
      dispatchPointerEvent('pointerdown')
      dispatchPointerEvent('pointerup')
      jasmine.clock().tick(1100)

      expect(actions.length).toBe(1)
      expect(actions[0].name).toBe('应付凭证')
      expect(actions[0].target.selector).toBe('#shadow-host::shadow BUTTON')
    } finally {
      collection.stop()
      host.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should use a shadow DOM target created in another window realm', () => {
    jasmine.clock().install()
    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const actions = []
    const iframe = document.createElement('iframe')
    const shell = document.createElement('div')
    const breadcrumb = document.createElement('div')
    breadcrumb.innerText = '首页 对公付款'
    const host = document.createElement('div')
    host.id = 'cross-realm-shadow-host'
    document.body.appendChild(iframe)
    shell.appendChild(breadcrumb)
    shell.appendChild(host)
    document.body.appendChild(shell)
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const foreignWindow = iframe.contentWindow
    const button = foreignWindow.document.createElement('button')
    button.innerText = '跨 Realm 按钮'
    shadowRoot.appendChild(button)

    expect(button instanceof Element).toBeFalse()

    const collection = trackClickActions(lifeCycle, domMutationObservable, {
      excludedActivityUrls: []
    })
    lifeCycle.subscribe(LifeCycleEventType.AUTO_ACTION_COMPLETED, (action) => {
      actions.push(action)
    })

    function dispatchPointerEvent(type) {
      const event = new foreignWindow.Event(type, {
        bubbles: true,
        composed: true
      })
      Object.assign(event, {
        isPrimary: true,
        clientX: 0,
        clientY: 0
      })
      button.dispatchEvent(event)
    }

    try {
      dispatchPointerEvent('pointerdown')
      dispatchPointerEvent('pointerup')
      jasmine.clock().tick(1100)

      expect(actions.length).toBe(1)
      expect(actions[0].name).toBe('跨 Realm 按钮')
      expect(actions[0].target.selector).toBe(
        '#cross-realm-shadow-host::shadow BUTTON'
      )
    } finally {
      collection.stop()
      shell.remove()
      iframe.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should not use arbitrary text fallback for shadow DOM action names', () => {
    jasmine.clock().install()
    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const actions = []
    const host = document.createElement('div')
    host.id = 'shadow-card-host'
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const card = document.createElement('div')
    const target = document.createElement('span')
    target.innerText = '思'
    const amount = document.createElement('span')
    amount.innerText = '￥4,910.73'
    card.appendChild(target)
    card.appendChild(amount)
    shadowRoot.appendChild(card)
    document.body.appendChild(host)

    const collection = trackClickActions(lifeCycle, domMutationObservable, {
      excludedActivityUrls: []
    })
    lifeCycle.subscribe(LifeCycleEventType.AUTO_ACTION_COMPLETED, (action) => {
      actions.push(action)
    })

    function dispatchPointerEvent(type) {
      const event = new Event(type, {
        bubbles: true,
        composed: true
      })
      Object.assign(event, {
        isPrimary: true,
        clientX: 0,
        clientY: 0
      })
      target.dispatchEvent(event)
    }

    try {
      dispatchPointerEvent('pointerdown')
      dispatchPointerEvent('pointerup')
      jasmine.clock().tick(1100)

      expect(actions.length).toBe(1)
      expect(actions[0].name).toBe('')
      expect(actions[0].target.selector).toBe(
        '#shadow-card-host::shadow DIV>SPAN:nth-of-type(1)'
      )
    } finally {
      collection.stop()
      host.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should keep textual fallback for normal DOM action names', () => {
    jasmine.clock().install()
    const lifeCycle = new LifeCycle()
    const domMutationObservable = new Observable()
    const actions = []
    const target = document.createElement('span')
    target.id = 'normal-action-target'
    target.innerText = '思'
    document.body.appendChild(target)

    const collection = trackClickActions(lifeCycle, domMutationObservable, {
      excludedActivityUrls: []
    })
    lifeCycle.subscribe(LifeCycleEventType.AUTO_ACTION_COMPLETED, (action) => {
      actions.push(action)
    })

    function dispatchPointerEvent(type) {
      const event = new Event(type, {
        bubbles: true
      })
      Object.assign(event, {
        isPrimary: true,
        clientX: 0,
        clientY: 0
      })
      target.dispatchEvent(event)
    }

    try {
      dispatchPointerEvent('pointerdown')
      dispatchPointerEvent('pointerup')
      jasmine.clock().tick(1100)

      expect(actions.length).toBe(1)
      expect(actions[0].name).toBe('思')
      expect(actions[0].target.selector).toBe('#normal-action-target')
    } finally {
      collection.stop()
      target.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should discard individual clicks and validate the rage click when rage is detected', () => {
    const target = document.createElement('div')
    const clicks = [100, 300, 700].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )
    const rageClick = createClick({
      stop: jasmine.createSpy('rageStop'),
      validate: jasmine.createSpy('rageValidate'),
      hasError: () => true
    })

    finalizeClicks(clicks, rageClick)

    clicks.forEach((click) => {
      expect(click.discard).toHaveBeenCalled()
      expect(click.validate).not.toHaveBeenCalled()
    })
    expect(rageClick.stop).toHaveBeenCalled()
    expect(rageClick.validate).toHaveBeenCalledWith(
      clicks.map((click) => click.event)
    )
    expect(rageClick.frustrations).toEqual([
      FrustrationType.RAGE_CLICK,
      FrustrationType.DEAD_CLICK,
      FrustrationType.ERROR_CLICK
    ])
  })

  it('should discard the rage click and validate each click when rage is not detected', () => {
    const target = document.createElement('div')
    const clicks = [0, 1500].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )
    const rageClick = createClick({
      discard: jasmine.createSpy('rageDiscard')
    })

    finalizeClicks(clicks, rageClick)

    expect(rageClick.discard).toHaveBeenCalled()
    expect(rageClick.validate).not.toHaveBeenCalled()
    clicks.forEach((click) => {
      expect(click.validate).toHaveBeenCalled()
      expect(click.discard).not.toHaveBeenCalled()
    })
  })

  it('should propagate per-click frustrations before validating a non-rage chain', () => {
    const deadClick = createClick({
      event: {
        timeStamp: 0,
        target: document.createElement('div')
      }
    })
    const errorClick = createClick({
      event: {
        timeStamp: 1500,
        target: document.createElement('input')
      },
      hasError: () => true,
      getUserActivity: () => ({
        selection: false,
        scroll: false,
        input: true
      })
    })

    finalizeClicks([deadClick, errorClick], createClick())

    expect(deadClick.frustrations).toEqual([FrustrationType.DEAD_CLICK])
    expect(errorClick.frustrations).toEqual([FrustrationType.ERROR_CLICK])
    expect(deadClick.validate).toHaveBeenCalled()
    expect(errorClick.validate).toHaveBeenCalled()
  })

  it('should keep only the rage frustration when no dead or error condition is met', () => {
    const target = document.createElement('textarea')
    const clicks = [100, 300, 700].map((timeStamp) =>
      createClick({
        event: { timeStamp, target }
      })
    )
    const rageClick = createClick({
      stop: jasmine.createSpy('rageStop'),
      validate: jasmine.createSpy('rageValidate'),
      hasError: () => false
    })

    finalizeClicks(clicks, rageClick)

    expect(rageClick.frustrations).toEqual([FrustrationType.RAGE_CLICK])
    expect(rageClick.validate).toHaveBeenCalled()
  })
})
