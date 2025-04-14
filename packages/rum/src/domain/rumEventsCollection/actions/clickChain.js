import {
  ONE_SECOND,
  every,
  setTimeout,
  clearTimeout
} from '@cloudcare/browser-core'

export var MAX_DURATION_BETWEEN_CLICKS = ONE_SECOND
export var MAX_DISTANCE_BETWEEN_CLICKS = 100

var ClickChainStatus = {
  WaitingForMoreClicks: 0,
  WaitingForClicksToStop: 1,
  Finalized: 2
}

export function createClickChain(firstClick, onFinalize) {
  var bufferedClicks = []
  var status = ClickChainStatus.WaitingForMoreClicks
  var maxDurationBetweenClicksTimeout
  appendClick(firstClick)

  function appendClick(click) {
    click.stopObservable.subscribe(tryFinalize)
    bufferedClicks.push(click)
    clearTimeout(maxDurationBetweenClicksTimeout)
    maxDurationBetweenClicksTimeout = setTimeout(
      dontAcceptMoreClick,
      MAX_DURATION_BETWEEN_CLICKS
    )
  }

  function tryFinalize() {
    if (
      status === ClickChainStatus.WaitingForClicksToStop &&
      every(bufferedClicks, function (click) {
        return click.isStopped()
      })
    ) {
      status = ClickChainStatus.Finalized
      onFinalize(bufferedClicks)
    }
  }

  function dontAcceptMoreClick() {
    clearTimeout(maxDurationBetweenClicksTimeout)
    if (status === ClickChainStatus.WaitingForMoreClicks) {
      status = ClickChainStatus.WaitingForClicksToStop
      tryFinalize()
    }
  }

  return {
    tryAppend: function (click) {
      if (status !== ClickChainStatus.WaitingForMoreClicks) {
        return false
      }

      if (
        bufferedClicks.length > 0 &&
        !areEventsSimilar(
          bufferedClicks[bufferedClicks.length - 1].event,
          click.event
        )
      ) {
        dontAcceptMoreClick()
        return false
      }

      appendClick(click)
      return true
    },
    stop: function () {
      dontAcceptMoreClick()
    }
  }
}

/**
 * Checks whether two events are similar by comparing their target, position and timestamp
 */
function areEventsSimilar(first, second) {
  return (
    first.target === second.target &&
    mouseEventDistance(first, second) <= MAX_DISTANCE_BETWEEN_CLICKS &&
    first.timeStamp - second.timeStamp <= MAX_DURATION_BETWEEN_CLICKS
  )
}

function mouseEventDistance(origin, other) {
  return Math.sqrt(
    Math.pow(origin.clientX - other.clientX, 2) +
      Math.pow(origin.clientY - other.clientY, 2)
  )
}
