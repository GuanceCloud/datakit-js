import { elapsed, ONE_SECOND, relativeNow } from '@cloudcare/browser-core'

// Maximum duration for click actions
export const CLICK_ACTION_MAX_DURATION = 10 * ONE_SECOND
export const interactionSelectorCache = new Map()

export function getInteractionSelector(relativeTimestamp) {
  const selector = interactionSelectorCache.get(relativeTimestamp)
  interactionSelectorCache.delete(relativeTimestamp)
  return selector
}

export function updateInteractionSelector(relativeTimestamp, selector) {
  interactionSelectorCache.set(relativeTimestamp, selector)
  interactionSelectorCache.forEach(function (_, relativeTimestamp) {
    if (elapsed(relativeTimestamp, relativeNow()) > CLICK_ACTION_MAX_DURATION) {
      interactionSelectorCache.delete(relativeTimestamp)
    }
  })
}
