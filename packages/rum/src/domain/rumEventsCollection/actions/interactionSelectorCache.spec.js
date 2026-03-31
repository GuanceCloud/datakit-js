import {
  CLICK_ACTION_MAX_DURATION,
  getInteractionSelector,
  interactionSelectorCache,
  updateInteractionSelector
} from './interactionSelectorCache'

describe('interactionSelectorCache', () => {
  afterEach(() => {
    interactionSelectorCache.clear()
  })

  it('should return and remove a stored selector', () => {
    const now = performance.now()

    updateInteractionSelector(now, '.checkout-button')

    expect(getInteractionSelector(now)).toBe('.checkout-button')
    expect(getInteractionSelector(now)).toBeUndefined()
  })

  it('should evict stale selectors when updating the cache', () => {
    jasmine.clock().install()
    jasmine.clock().mockDate(new Date('2026-03-31T00:00:00.000Z'))
    const now = performance.now()

    updateInteractionSelector(now - CLICK_ACTION_MAX_DURATION - 1, '.stale')
    updateInteractionSelector(now, '.fresh')

    expect(interactionSelectorCache.has(now)).toBeTrue()
    expect(interactionSelectorCache.size).toBe(1)

    jasmine.clock().uninstall()
  })
})
