import { startDisplayContext } from './displayContext'

describe('displayContext', () => {
  let originalInnerWidth
  let originalInnerHeight
  let originalVisualViewport

  beforeEach(() => {
    jasmine.clock().install()
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
    originalVisualViewport = window.visualViewport
  })

  afterEach(() => {
    jasmine.clock().uninstall()
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport
    })
  })

  it('should expose the initial viewport and update it from the observable', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 100,
        height: 200,
        scale: 1
      }
    })

    const displayContext = startDisplayContext()

    expect(displayContext.get()).toEqual({
      viewport: { width: 100, height: 200 }
    })

    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 150,
        height: 200,
        scale: 2
      }
    })
    window.dispatchEvent(new Event('resize'))
    jasmine.clock().tick(201)

    expect(displayContext.get()).toEqual({
      viewport: { width: 300, height: 400 }
    })

    displayContext.stop()
  })
})
