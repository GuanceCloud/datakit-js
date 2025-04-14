import {
  elementMatches,
  ONE_SECOND,
  FrustrationType,
  some,
  each
} from '@cloudcare/browser-core'

var MIN_CLICKS_PER_SECOND_TO_CONSIDER_RAGE = 3

export function computeFrustration(clicks, rageClick) {
  if (isRage(clicks)) {
    rageClick.addFrustration(FrustrationType.RAGE_CLICK)
    if (some(clicks, isDead)) {
      rageClick.addFrustration(FrustrationType.DEAD_CLICK)
    }
    if (rageClick.hasError()) {
      rageClick.addFrustration(FrustrationType.ERROR_CLICK)
    }
    return { isRage: true }
  }

  var hasSelectionChanged = some(clicks, function (click) {
    return click.getUserActivity().selection
  })
  each(clicks, function (click) {
    if (click.hasError()) {
      click.addFrustration(FrustrationType.ERROR_CLICK)
    }
    if (
      isDead(click) &&
      // Avoid considering clicks part of a double-click or triple-click selections as dead clicks
      !hasSelectionChanged
    ) {
      click.addFrustration(FrustrationType.DEAD_CLICK)
    }
  })

  return { isRage: false }
}

export function isRage(clicks) {
  if (
    some(clicks, function (click) {
      return click.getUserActivity().selection || click.getUserActivity().scroll
    })
  ) {
    return false
  }
  for (
    var i = 0;
    i < clicks.length - (MIN_CLICKS_PER_SECOND_TO_CONSIDER_RAGE - 1);
    i += 1
  ) {
    if (
      clicks[i + MIN_CLICKS_PER_SECOND_TO_CONSIDER_RAGE - 1].event.timeStamp -
        clicks[i].event.timeStamp <=
      ONE_SECOND
    ) {
      return true
    }
  }
  return false
}

var DEAD_CLICK_EXCLUDE_SELECTOR =
  // inputs that don't trigger a meaningful event like "input" when clicked, including textual
  // inputs (using a negative selector is shorter here)
  'input:not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="range"]),' +
  'textarea,' +
  'select,' +
  // contenteditable and their descendants don't always trigger meaningful changes when manipulated
  '[contenteditable],' +
  '[contenteditable] *,' +
  // canvas, as there is no good way to detect activity occurring on them
  'canvas,' +
  // links that are interactive (have an href attribute) or any of their descendants, as they can
  // open a new tab or navigate to a hash without triggering a meaningful event
  'a[href],' +
  'a[href] *'

export function isDead(click) {
  if (
    click.hasPageActivity() ||
    click.getUserActivity().input ||
    click.getUserActivity().scroll
  ) {
    return false
  }
  return !elementMatches(click.event.target, DEAD_CLICK_EXCLUDE_SELECTOR)
}
