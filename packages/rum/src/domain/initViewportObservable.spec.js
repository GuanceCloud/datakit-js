import {
  createViewportObservable,
  getViewportDimension,
  initViewportObservable
} from './initViewportObservable'

describe('initViewportObservable', () => {
  let originalVisualViewport
  let originalInnerWidth
  let originalInnerHeight

  beforeEach(() => {
    originalVisualViewport = window.visualViewport
    originalInnerWidth = window.innerWidth
    originalInnerHeight = window.innerHeight
  })

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: originalVisualViewport
    })
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: originalInnerWidth
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: originalInnerHeight
    })
  })

  it('should reuse the singleton viewport observable', () => {
    expect(initViewportObservable()).toBe(initViewportObservable())
  })

  it('should compute dimensions from visualViewport when available', () => {
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        width: 200,
        height: 100,
        scale: 2
      }
    })

    expect(getViewportDimension()).toEqual({
      width: 400,
      height: 200
    })
  })

  it('should notify subscribers on resize', () => {
    jasmine.clock().install()
    const observable = createViewportObservable()
    const subscriber = jasmine.createSpy('subscriber')
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: undefined
    })
    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      value: 320
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      value: 640
    })

    const subscription = observable.subscribe(subscriber)
    window.dispatchEvent(new Event('resize'))
    jasmine.clock().tick(250)

    expect(subscriber).toHaveBeenCalledWith({
      width: 320,
      height: 640
    })

    subscription.unsubscribe()
    jasmine.clock().uninstall()
  })
})
