import {
  ActionType,
  LifeCycleEventType,
  RumEventType
} from '@cloudcare/browser-core'
import { NodePrivacyLevel } from '../../../constants'
import { RecordType } from '../../../types'
import {
  getRecordIdForEvent,
  initFrustrationObserver,
  initInputObserver,
  initObservers
} from './observers'
import {
  getSerializedNodeId,
  setSerializedNodeId
} from './serializationUtils'

describe('replay/record/observers', () => {
  it('should capture property setters from observed iframe realm form controls', async () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const foreignDocument = iframe.contentWindow.document
    const input = foreignDocument.createElement('input')
    const checkbox = foreignDocument.createElement('input')
    checkbox.type = 'checkbox'
    const textarea = foreignDocument.createElement('textarea')
    const select = foreignDocument.createElement('select')
    select.appendChild(foreignDocument.createElement('option'))
    const selectedOption = foreignDocument.createElement('option')
    selectedOption.value = 'selected-wujie-value'
    select.appendChild(selectedOption)
    const shadowRoot = host.attachShadow({ mode: 'open' })
    shadowRoot.appendChild(input)
    shadowRoot.appendChild(checkbox)
    shadowRoot.appendChild(textarea)
    shadowRoot.appendChild(select)
    setSerializedNodeId(input, 97)
    setSerializedNodeId(checkbox, 98)
    setSerializedNodeId(textarea, 99)
    setSerializedNodeId(select, 100)
    const inputCb = jasmine.createSpy('inputCb')
    const stop = initInputObserver(
      inputCb,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      undefined,
      function () {
        return false
      }
    )

    try {
      stop.observeInputNode(input)
      stop.observeInputNode(checkbox)
      stop.observeInputNode(textarea)
      stop.observeInputNode(select)
      input.value = 'setter-wujie-value'
      checkbox.checked = true
      textarea.value = 'textarea-wujie-value'
      select.selectedIndex = 1
      await new Promise((resolve) => setTimeout(resolve, 0))

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: 97, text: 'setter-wujie-value' }],
        [{ id: 98, isChecked: true }],
        [{ id: 99, text: 'textarea-wujie-value' }],
        [{ id: 100, text: 'selected-wujie-value' }]
      ])
    } finally {
      stop()
      host.remove()
      iframe.remove()
    }
  })

  it('should ignore non-input private form tags', () => {
    const output = document.createElement('output')
    document.body.appendChild(output)
    setSerializedNodeId(output, 96)
    const inputCb = jasmine.createSpy('inputCb')
    const stop = initInputObserver(
      inputCb,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW }
    )

    try {
      output.value = 'not-an-input-update'
      output.dispatchEvent(new Event('input', { bubbles: true }))
      expect(inputCb).not.toHaveBeenCalled()
    } finally {
      stop()
      output.remove()
    }
  })

  it('should capture input changes from an iframe realm inside a shadow root', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const foreignWindow = iframe.contentWindow
    const input = foreignWindow.document.createElement('input')
    input.value = 'wujie-value'
    shadowRoot.appendChild(input)
    setSerializedNodeId(input, 98)
    const inputCb = jasmine.createSpy('inputCb')
    const stop = initInputObserver(
      inputCb,
      { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
      shadowRoot,
      function () {
        return false
      }
    )

    try {
      expect(input instanceof HTMLInputElement).toBeFalse()
      input.dispatchEvent(
        new foreignWindow.Event('change', {
          bubbles: true,
          composed: false
        })
      )

      expect(inputCb).toHaveBeenCalledOnceWith({
        id: 98,
        text: 'wujie-value'
      })
    } finally {
      stop()
      host.remove()
      iframe.remove()
    }
  })

  it('should roll back previously initialized observers when a later observer fails', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)
    setSerializedNodeId(input, 99)
    const inputCb = jasmine.createSpy('inputCb')
    const callback = jasmine.createSpy('callback')

    expect(() =>
      initObservers({
        lifeCycle: {
          subscribe() {
            throw new Error('frustration observer initialization failed')
          }
        },
        configuration: {
          defaultPrivacyLevel: NodePrivacyLevel.ALLOW
        },
        elementsScrollPositions: new Map(),
        inputCb,
        mediaInteractionCb: callback,
        mouseInteractionCb: callback,
        mousemoveCb: callback,
        mutationCb: callback,
        mutationPerfCb: callback,
        mutationOverflowCb: callback,
        mutationActivityCb: callback,
        scrollCb: callback,
        styleSheetCb: callback,
        viewportResizeCb: callback,
        frustrationCb: callback,
        focusCb: callback,
        visualViewportResizeCb: callback,
        shadowRootsController: {
          addShadowRoot: function () {
            return true
          },
          removeShadowRoot: function () {}
        }
      })
    ).toThrowError('frustration observer initialization failed')

    input.value = 'after-failure'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    expect(inputCb).not.toHaveBeenCalled()
    input.remove()
  })

  it('should gate property setter and composed input callbacks for skipped shadow nodes', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    shadowRoot.appendChild(input)
    setSerializedNodeId(input, 100)

    let skipped = true
    const inputCb = jasmine.createSpy('inputCb')
    const callback = jasmine.createSpy('callback')
    const unsubscribe = jasmine.createSpy('unsubscribe')
    const observers = initObservers({
      lifeCycle: {
        subscribe() {
          return { unsubscribe }
        }
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      elementsScrollPositions: new Map(),
      inputCb,
      mediaInteractionCb: callback,
      mouseInteractionCb: callback,
      mousemoveCb: callback,
      mutationCb: callback,
      mutationPerfCb: callback,
      mutationOverflowCb: callback,
      mutationActivityCb: callback,
      scrollCb: callback,
      styleSheetCb: callback,
      viewportResizeCb: callback,
      frustrationCb: callback,
      focusCb: callback,
      visualViewportResizeCb: callback,
      shadowRootsController: {
        addShadowRoot: function () {
          return true
        },
        removeShadowRoot: function () {},
        isNodeInSkippedShadowRoot: function (node) {
          return (
            skipped &&
            node &&
            typeof node.getRootNode === 'function' &&
            node.getRootNode() === shadowRoot
          )
        }
      }
    })

    try {
      input.value = 'ignored'
      input.dispatchEvent(
        new Event('input', { bubbles: true, composed: true })
      )
      expect(inputCb).not.toHaveBeenCalled()

      skipped = false
      input.dispatchEvent(
        new Event('input', { bubbles: true, composed: true })
      )
      expect(inputCb).toHaveBeenCalledOnceWith({
        id: 100,
        text: 'ignored'
      })
    } finally {
      observers.stop()
      host.remove()
    }
  })

  it('should retain scroll state while its incremental record is gated', () => {
    jasmine.clock().install()
    const element = document.createElement('div')
    document.body.appendChild(element)
    Object.defineProperty(element, 'scrollTop', {
      configurable: true,
      value: 42
    })
    setSerializedNodeId(element, 101)
    const scrollPositions = new Map()
    const scrollCb = jasmine.createSpy('scrollCb')
    const callback = jasmine.createSpy('callback')
    const observers = initObservers({
      lifeCycle: {
        subscribe() {
          return { unsubscribe: function () {} }
        }
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      elementsScrollPositions: scrollPositions,
      inputCb: callback,
      mediaInteractionCb: callback,
      mouseInteractionCb: callback,
      mousemoveCb: callback,
      mutationCb: callback,
      mutationPerfCb: callback,
      mutationOverflowCb: callback,
      mutationActivityCb: callback,
      scrollCb,
      styleSheetCb: callback,
      viewportResizeCb: callback,
      frustrationCb: callback,
      focusCb: callback,
      visualViewportResizeCb: callback,
      isNodeIgnored: function () {
        return true
      },
      shadowRootsController: {
        addShadowRoot: function () {
          return true
        },
        removeShadowRoot: function () {}
      }
    })

    try {
      element.dispatchEvent(new Event('scroll', { bubbles: true }))
      jasmine.clock().tick(100)

      expect(scrollPositions.get(element)).toEqual({
        scrollTop: 42,
        scrollLeft: 0
      })
      expect(scrollCb).not.toHaveBeenCalled()
    } finally {
      observers.stop()
      element.remove()
      jasmine.clock().uninstall()
    }
  })

  it('should use strict ignore checks for stateless interactions only', () => {
    jasmine.clock().install()
    const target = document.createElement('input')
    document.body.appendChild(target)
    setSerializedNodeId(target, 102)
    let frustrationHandler
    const statefulIgnore = jasmine
      .createSpy('statefulIgnore')
      .and.returnValue(false)
    const statelessIgnore = jasmine
      .createSpy('statelessIgnore')
      .and.returnValue(true)
    const inputCb = jasmine.createSpy('inputCb')
    const mousemoveCb = jasmine.createSpy('mousemoveCb')
    const mouseInteractionCb = jasmine.createSpy(
      'mouseInteractionCb'
    )
    const frustrationCb = jasmine.createSpy('frustrationCb')
    const callback = jasmine.createSpy('callback')
    const observers = initObservers({
      lifeCycle: {
        subscribe(_eventType, handler) {
          frustrationHandler = handler
          return { unsubscribe: function () {} }
        }
      },
      configuration: {
        defaultPrivacyLevel: NodePrivacyLevel.ALLOW
      },
      elementsScrollPositions: new Map(),
      inputCb,
      mediaInteractionCb: callback,
      mouseInteractionCb,
      mousemoveCb,
      mutationCb: callback,
      mutationPerfCb: callback,
      mutationOverflowCb: callback,
      mutationActivityCb: callback,
      scrollCb: callback,
      styleSheetCb: callback,
      viewportResizeCb: callback,
      frustrationCb,
      focusCb: callback,
      visualViewportResizeCb: callback,
      isNodeIgnored: statefulIgnore,
      isNodeIgnoredForStatelessObserver: statelessIgnore,
      shadowRootsController: {
        addShadowRoot: function () {
          return true
        },
        removeShadowRoot: function () {}
      }
    })

    try {
      const moveEvent = new MouseEvent('mousemove', {
        bubbles: true,
        clientX: 1,
        clientY: 2
      })
      const clickEvent = new MouseEvent('click', {
        bubbles: true,
        clientX: 3,
        clientY: 4
      })
      target.dispatchEvent(moveEvent)
      target.dispatchEvent(clickEvent)
      frustrationHandler({
        rawRumEvent: {
          date: 1234,
          type: RumEventType.ACTION,
          action: {
            type: ActionType.CLICK,
            frustration: { type: ['rage_click'] }
          }
        },
        domainContext: { events: [clickEvent] }
      })

      expect(statelessIgnore).toHaveBeenCalledTimes(3)
      expect(statefulIgnore).not.toHaveBeenCalled()
      expect(mousemoveCb).not.toHaveBeenCalled()
      expect(mouseInteractionCb).not.toHaveBeenCalled()
      expect(frustrationCb).not.toHaveBeenCalled()

      target.value = 'stateful-input'
      target.dispatchEvent(new Event('input', { bubbles: true }))
      expect(statefulIgnore).toHaveBeenCalledWith(target)
      expect(inputCb).toHaveBeenCalledOnceWith({
        id: 102,
        text: 'stateful-input'
      })
    } finally {
      try {
        observers.stop()
        target.remove()
      } finally {
        jasmine.clock().uninstall()
      }
    }
  })

  it('should allocate stable record ids per event object', () => {
    const eventA = {}
    const eventB = {}

    const firstId = getRecordIdForEvent(eventA)
    const secondId = getRecordIdForEvent(eventA)
    const thirdId = getRecordIdForEvent(eventB)

    expect(firstId).toBe(secondId)
    expect(thirdId).toBeGreaterThan(firstId)
  })

  it('should emit frustration records for click actions with frustration metadata', () => {
    let handler
    const lifeCycle = {
      subscribe(eventType, callback) {
        expect(eventType).toBe(LifeCycleEventType.RAW_RUM_EVENT_COLLECTED)
        handler = callback
        return {
          unsubscribe: jasmine.createSpy('unsubscribe')
        }
      }
    }
    const frustrationCb = jasmine.createSpy('frustrationCb')
    const event1 = {}
    const event2 = {}
    const stop = initFrustrationObserver(lifeCycle, frustrationCb, {})

    handler({
      rawRumEvent: {
        date: 1234,
        type: RumEventType.ACTION,
        action: {
          type: ActionType.CLICK,
          frustration: {
            type: ['rage_click']
          }
        }
      },
      domainContext: {
        events: [event1, event2]
      }
    })

    expect(frustrationCb).toHaveBeenCalledWith({
      timestamp: 1234,
      type: RecordType.FrustrationRecord,
      data: {
        frustrationTypes: ['rage_click'],
        recordIds: [getRecordIdForEvent(event1), getRecordIdForEvent(event2)]
      }
    })
    expect(stop).toEqual(jasmine.any(Function))
  })

  it('should ignore non-frustration or non-click events', () => {
    let handler
    const lifeCycle = {
      subscribe(eventType, callback) {
        handler = callback
        return {
          unsubscribe: jasmine.createSpy('unsubscribe')
        }
      }
    }
    const frustrationCb = jasmine.createSpy('frustrationCb')

    initFrustrationObserver(lifeCycle, frustrationCb, {})

    handler({
      rawRumEvent: {
        date: 10,
        type: RumEventType.VIEW,
        action: {
          type: ActionType.CLICK
        }
      },
      domainContext: {
        events: [{}]
      }
    })
    handler({
      rawRumEvent: {
        date: 10,
        type: RumEventType.ACTION,
        action: {
          type: ActionType.CLICK,
          frustration: {
            type: []
          }
        }
      },
      domainContext: {
        events: [{}]
      }
    })

    expect(frustrationCb).not.toHaveBeenCalled()
  })

  describe('radio input observation', () => {
    let fixtures
    let observerStops
    let nextSerializedId

    beforeEach(() => {
      fixtures = []
      observerStops = []
      nextSerializedId = 100
    })

    afterEach(() => {
      observerStops.forEach(function (stop) {
        stop()
      })
      fixtures.forEach(function (fixture) {
        fixture.remove()
      })
    })

    function observeInputs(callback, root) {
      var stop = initInputObserver(
        callback,
        { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
        root
      )
      observerStops.push(stop)
    }

    function createRadio(parent, name, checked) {
      var radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = name
      radio.checked = !!checked
      setSerializedNodeId(radio, nextSerializedId)
      nextSerializedId += 1
      parent.appendChild(radio)
      return radio
    }

    function dispatchRadioChange(radio, checked, eventType) {
      radio.checked = checked
      radio.dispatchEvent(
        new Event(eventType || 'input', {
          bubbles: true,
          composed: true
        })
      )
    }

    it('should not emit unchanged peers when a radio group is first observed', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var first = createRadio(fixture, 'first-interaction', false)
      createRadio(fixture, 'first-interaction', true)
      createRadio(fixture, 'first-interaction', false)
      createRadio(fixture, 'first-interaction', false)
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(first, true)

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(first), isChecked: true }]
      ])
    })

    it('should emit only the newly checked and previously observed radio', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var first = createRadio(fixture, 'tracked-group', false)
      var second = createRadio(fixture, 'tracked-group', false)
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(first, true)
      inputCb.calls.reset()
      dispatchRadioChange(second, true)

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(second), isChecked: true }],
        [{ id: getSerializedId(first), isChecked: false }]
      ])
    })

    it('should not emit a previously tracked radio after it becomes unpublished', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var first = createRadio(fixture, 'publication-group', false)
      var second = createRadio(fixture, 'publication-group', false)
      var unpublishedRadio
      var inputCb = jasmine.createSpy('inputCb')
      observerStops.push(
        initInputObserver(
          inputCb,
          { defaultPrivacyLevel: NodePrivacyLevel.ALLOW },
          undefined,
          function (node) {
            return node === unpublishedRadio
          }
        )
      )

      dispatchRadioChange(first, true)
      inputCb.calls.reset()
      unpublishedRadio = first
      dispatchRadioChange(second, true)

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(second), isChecked: true }]
      ])
    })

    it('should emit an explicit uncheck once and deduplicate repeated state', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var radio = createRadio(fixture, 'explicit-uncheck', false)
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(radio, true)
      inputCb.calls.reset()
      dispatchRadioChange(radio, false)
      dispatchRadioChange(radio, false)

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(radio), isChecked: false }]
      ])
    })

    it('should keep large radio groups O(1) per observed selection', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var radios = []
      for (var index = 0; index < 1000; index += 1) {
        radios.push(
          createRadio(fixture, 'large-radio-group', index === 0)
        )
      }
      var querySelectorAll = spyOn(
        document,
        'querySelectorAll'
      ).and.callThrough()
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(radios[999], true)
      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(radios[999]), isChecked: true }]
      ])

      inputCb.calls.reset()
      dispatchRadioChange(radios[500], true)
      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(radios[500]), isChecked: true }],
        [{ id: getSerializedId(radios[999]), isChecked: false }]
      ])
      expect(querySelectorAll).not.toHaveBeenCalled()
    })

    it('should evict old dynamic group names from the bounded registry', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var first = createRadio(fixture, 'evicted-group', false)
      var replacement = createRadio(fixture, 'evicted-group', false)
      var otherRadios = []
      for (var index = 0; index < 256; index += 1) {
        otherRadios.push(
          createRadio(fixture, 'dynamic-group-' + index, false)
        )
      }
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(first, true)
      otherRadios.forEach(function (radio) {
        dispatchRadioChange(radio, true)
      })
      inputCb.calls.reset()

      dispatchRadioChange(replacement, true)

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(replacement), isChecked: true }]
      ])
    })

    it('should discard detached or regrouped tracked radios', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var regrouped = createRadio(fixture, 'stale-group', false)
      var regroupedReplacement = createRadio(
        fixture,
        'stale-group',
        false
      )
      var detached = createRadio(fixture, 'detached-group', false)
      var detachedReplacement = createRadio(
        fixture,
        'detached-group',
        false
      )
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(regrouped, true)
      regrouped.name = 'new-group'
      inputCb.calls.reset()
      dispatchRadioChange(regroupedReplacement, true)
      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(regroupedReplacement), isChecked: true }]
      ])

      dispatchRadioChange(detached, true)
      detached.remove()
      inputCb.calls.reset()
      dispatchRadioChange(detachedReplacement, true)
      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(detachedReplacement), isChecked: true }]
      ])
    })

    it('should synchronize radios only inside their shadow root', () => {
      var host = document.createElement('div')
      fixtures.push(host)
      document.body.appendChild(host)
      var shadowRoot = host.attachShadow({ mode: 'open' })
      var first = createRadio(shadowRoot, 'scoped-group', false)
      var second = createRadio(shadowRoot, 'scoped-group', false)
      var outside = createRadio(document.body, 'scoped-group', true)
      fixtures.push(outside)
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb, shadowRoot)

      dispatchRadioChange(first, true, 'change')
      inputCb.calls.reset()
      dispatchRadioChange(second, true, 'change')

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(second), isChecked: true }],
        [{ id: getSerializedId(first), isChecked: false }]
      ])
      expect(outside.checked).toBeTrue()
    })

    it('should support radio names containing selector-special characters', () => {
      var fixture = document.createElement('div')
      fixtures.push(fixture)
      document.body.appendChild(fixture)
      var specialName = 'quote"][data-probe="value\\\\tail'
      var first = createRadio(fixture, specialName, false)
      var second = createRadio(fixture, specialName, false)
      var inputCb = jasmine.createSpy('inputCb')
      observeInputs(inputCb)

      dispatchRadioChange(first, true)
      inputCb.calls.reset()
      dispatchRadioChange(second, true)

      expect(inputCb.calls.allArgs()).toEqual([
        [{ id: getSerializedId(second), isChecked: true }],
        [{ id: getSerializedId(first), isChecked: false }]
      ])
    })

    function getSerializedId(node) {
      return getSerializedNodeId(node)
    }
  })
})
