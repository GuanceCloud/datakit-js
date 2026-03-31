import { createElementsScrollPositions } from './elementsScrollPositions'

describe('replay/record/elementsScrollPositions', () => {
  it('should store positions for regular elements', () => {
    const positions = createElementsScrollPositions()
    const element = document.createElement('div')
    const value = { scrollLeft: 12, scrollTop: 34 }

    positions.set(element, value)

    expect(positions.has(element)).toBeTrue()
    expect(positions.get(element)).toEqual(value)
  })

  it('should map document to scrollingElement when available', () => {
    const positions = createElementsScrollPositions()
    const originalScrollingElement = document.scrollingElement
    const scrollingElement = document.createElement('div')
    const value = { scrollLeft: 1, scrollTop: 2 }

    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: scrollingElement
    })

    positions.set(document, value)

    expect(positions.has(scrollingElement)).toBeTrue()
    expect(positions.get(scrollingElement)).toEqual(value)

    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: originalScrollingElement
    })
  })

  it('should ignore document when scrollingElement is unavailable', () => {
    const positions = createElementsScrollPositions()
    const originalScrollingElement = document.scrollingElement

    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: null
    })

    positions.set(document, { scrollLeft: 1, scrollTop: 2 })

    expect(positions.has(document)).toBeFalse()

    Object.defineProperty(document, 'scrollingElement', {
      configurable: true,
      value: originalScrollingElement
    })
  })
})
