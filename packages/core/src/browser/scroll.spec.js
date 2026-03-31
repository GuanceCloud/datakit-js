import { getScrollX, getScrollY } from './scroll'

describe('scroll helpers', () => {
  let originalVisualViewport
  let originalScrollX
  let originalScrollY
  let originalPageXOffset
  let originalPageYOffset

  beforeEach(() => {
    originalVisualViewport = window.visualViewport
    originalScrollX = window.scrollX
    originalScrollY = window.scrollY
    originalPageXOffset = window.pageXOffset
    originalPageYOffset = window.pageYOffset
  })

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport
    })
    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: originalScrollX
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: originalScrollY
    })
    Object.defineProperty(window, 'pageXOffset', {
      configurable: true,
      value: originalPageXOffset
    })
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      value: originalPageYOffset
    })
  })

  it('should prefer visual viewport offsets when available', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        pageLeft: 10.6,
        offsetLeft: 1.1,
        pageTop: 20.2,
        offsetTop: 4.1
      }
    })

    expect(getScrollX()).toBe(10)
    expect(getScrollY()).toBe(16)
  })

  it('should fall back to scrollX/scrollY then page offsets', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: 7.7
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 8.2
    })

    expect(getScrollX()).toBe(8)
    expect(getScrollY()).toBe(8)

    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'pageXOffset', {
      configurable: true,
      value: 3.2
    })
    Object.defineProperty(window, 'pageYOffset', {
      configurable: true,
      value: 4.8
    })

    expect(getScrollX()).toBe(3)
    expect(getScrollY()).toBe(5)
  })
})
