import {
  convertMouseEventToLayoutCoordinates,
  getVisualViewport
} from './viewports'

describe('replay/record/viewports', () => {
  let originalVisualViewport
  let originalScrollX
  let originalScrollY

  beforeEach(() => {
    originalVisualViewport = window.visualViewport
    originalScrollX = window.scrollX
    originalScrollY = window.scrollY
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
  })

  it('should fall back to client coordinates when visualViewport is unavailable', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined
    })

    expect(convertMouseEventToLayoutCoordinates(10, 20)).toEqual({
      layoutViewportX: 10,
      layoutViewportY: 20,
      visualViewportX: 10,
      visualViewportY: 20
    })
  })

  it('should convert to layout viewport coordinates when visual viewport is factored in', () => {
    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: 5
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 7
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        scale: 2,
        offsetLeft: 20,
        offsetTop: 30,
        pageLeft: 60,
        pageTop: 80,
        width: 300,
        height: 200
      }
    })

    expect(convertMouseEventToLayoutCoordinates(10, 20)).toEqual({
      layoutViewportX: 30,
      layoutViewportY: 50,
      visualViewportX: 10,
      visualViewportY: 20
    })
  })

  it('should convert to visual viewport coordinates when desktop-style values are used', () => {
    Object.defineProperty(window, 'scrollX', {
      configurable: true,
      value: 40
    })
    Object.defineProperty(window, 'scrollY', {
      configurable: true,
      value: 50
    })
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        scale: 1,
        offsetLeft: 6,
        offsetTop: 8,
        pageLeft: 46,
        pageTop: 58,
        width: 500,
        height: 400
      }
    })

    expect(convertMouseEventToLayoutCoordinates(20, 30)).toEqual({
      layoutViewportX: 20,
      layoutViewportY: 30,
      visualViewportX: 14,
      visualViewportY: 22
    })
    expect(getVisualViewport()).toEqual({
      scale: 1,
      offsetLeft: 6,
      offsetTop: 8,
      pageLeft: 46,
      pageTop: 58,
      width: 500,
      height: 400
    })
  })
})
