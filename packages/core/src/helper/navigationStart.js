function isValidNavigationStart(value) {
  return typeof value === 'number' && isFinite(value) && value > 0
}

export function computeNavigationStart(performanceObject, currentTime) {
  var legacyNavigationStart =
    performanceObject.timing && performanceObject.timing.navigationStart
  if (isValidNavigationStart(legacyNavigationStart)) {
    return legacyNavigationStart
  }

  if (isValidNavigationStart(performanceObject.timeOrigin)) {
    return performanceObject.timeOrigin
  }

  return Math.round(currentTime - performanceObject.now())
}
