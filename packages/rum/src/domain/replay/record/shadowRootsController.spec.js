import { initShadowRootsController } from './shadowRootsController'
import { setSerializedNodeId } from './serializationUtils'

describe('replay/record/shadowRootsController', () => {
  it('should ignore unknown shadow roots and support empty flush/stop', () => {
    const controller = initShadowRootsController(
      {},
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb: jasmine.createSpy('inputCb')
      }
    )
    const shadowRoot = document.createElement('div').attachShadow({
      mode: 'open'
    })

    expect(() => controller.removeShadowRoot(shadowRoot)).not.toThrow()
    expect(() => controller.flush()).not.toThrow()
    expect(() => controller.stop()).not.toThrow()
  })

  it('should observe change events from added shadow roots and stop after removal', () => {
    const host = document.createElement('div')
    document.body.appendChild(host)

    const shadowRoot = host.attachShadow({ mode: 'open' })
    const input = document.createElement('input')
    input.value = 'first'
    setSerializedNodeId(input, 42)
    shadowRoot.appendChild(input)

    const inputCb = jasmine.createSpy('inputCb')
    const controller = initShadowRootsController(
      {
        defaultPrivacyLevel: undefined
      },
      {
        mutationCb: jasmine.createSpy('mutationCb'),
        inputCb
      }
    )

    controller.addShadowRoot(shadowRoot)
    controller.addShadowRoot(shadowRoot)

    input.value = 'changed'
    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(inputCb).toHaveBeenCalledTimes(1)
    expect(inputCb).toHaveBeenCalledWith({
      id: 42,
      text: 'changed'
    })

    controller.removeShadowRoot(shadowRoot)

    input.value = 'after-removal'
    input.dispatchEvent(new Event('change', { bubbles: true }))

    expect(inputCb).toHaveBeenCalledTimes(1)

    controller.stop()
    host.remove()
  })
})
