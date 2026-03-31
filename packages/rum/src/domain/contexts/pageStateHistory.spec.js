import { startPageStateHistory, PageState } from './pageStateHistory'

describe('pageStateHistory', () => {
  let originalVisibilityState
  let originalHasFocus

  beforeEach(() => {
    originalVisibilityState = Object.getOwnPropertyDescriptor(
      Document.prototype,
      'visibilityState'
    )
    originalHasFocus = document.hasFocus
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      value: 'visible'
    })
    document.hasFocus = jasmine.createSpy('hasFocus').and.returnValue(true)
  })

  afterEach(() => {
    if (originalVisibilityState) {
      Object.defineProperty(
        Document.prototype,
        'visibilityState',
        originalVisibilityState
      )
    }
    document.hasFocus = originalHasFocus
  })

  it('should track page states over time and answer state queries', () => {
    const pageStateHistory = startPageStateHistory()

    pageStateHistory.addPageState(PageState.ACTIVE, 10)
    pageStateHistory.addPageState(PageState.HIDDEN, 20)
    pageStateHistory.addPageState(PageState.ACTIVE, 30)

    expect(pageStateHistory.wasInPageStateAt(PageState.HIDDEN, 25)).toBeTrue()
    expect(
      pageStateHistory.wasInPageStateDuringPeriod(PageState.HIDDEN, 15, 20)
    ).toBeTrue()
    expect(pageStateHistory.wasInPageStateAt(PageState.FROZEN, 25)).toBeFalse()

    expect(pageStateHistory.findAll(15, 20)).toEqual([
      { state: PageState.ACTIVE, start: -15000000 },
      { state: PageState.HIDDEN, start: 5000000 },
      { state: PageState.ACTIVE, start: 15000000 }
    ])

    pageStateHistory.stop()
  })

  it('should limit the number of selectable page-state entries', () => {
    const pageStateHistory = startPageStateHistory(2)

    pageStateHistory.addPageState(PageState.ACTIVE, 10)
    pageStateHistory.addPageState(PageState.PASSIVE, 20)
    pageStateHistory.addPageState(PageState.HIDDEN, 30)
    pageStateHistory.addPageState(PageState.ACTIVE, 40)

    expect(pageStateHistory.findAll(0, 100)).toEqual([
      { state: PageState.ACTIVE, start: 0 },
      { state: PageState.PASSIVE, start: 20000000 }
    ])

    pageStateHistory.stop()
  })
})
