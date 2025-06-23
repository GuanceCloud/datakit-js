import { elapsed, ViewLoadingType } from '@cloudcare/browser-core'
import { waitPageActivityEnd } from '../../waitPageActivityEnd'
import { trackFirstHidden } from './trackFirstHidden'
export function trackLoadingTime(
  lifeCycle,
  domMutationObservable,
  configuration,
  loadType,
  viewStart,
  callback
) {
  var isWaitingForLoadEvent = loadType === ViewLoadingType.INITIAL_LOAD
  var isWaitingForActivityLoadingTime = true
  var loadingTimeCandidates = []
  var firstHidden = trackFirstHidden(viewStart)
  function invokeCallbackIfAllCandidatesAreReceived() {
    if (
      !isWaitingForActivityLoadingTime &&
      !isWaitingForLoadEvent &&
      loadingTimeCandidates.length > 0
    ) {
      var loadingTime = Math.max.apply(Math, loadingTimeCandidates)
      if (loadingTime < firstHidden.getTimeStamp() - viewStart.relative) {
        callback(loadingTime)
      }
    }
  }

  var _waitPageActivityEnd = waitPageActivityEnd(
    lifeCycle,
    domMutationObservable,
    configuration,
    function (event) {
      if (isWaitingForActivityLoadingTime) {
        isWaitingForActivityLoadingTime = false
        if (event.hadActivity) {
          loadingTimeCandidates.push(elapsed(viewStart.timeStamp, event.end))
        }
        invokeCallbackIfAllCandidatesAreReceived()
      }
    }
  )

  var stop = _waitPageActivityEnd.stop
  return {
    setLoadEvent: function (loadEvent) {
      if (isWaitingForLoadEvent) {
        isWaitingForLoadEvent = false
        loadingTimeCandidates.push(loadEvent)
        invokeCallbackIfAllCandidatesAreReceived()
      }
    },
    stop: function () {
      stop()
      firstHidden.stop()
      if (isWaitingForActivityLoadingTime) {
        isWaitingForActivityLoadingTime = false
        invokeCallbackIfAllCandidatesAreReceived()
      }
    }
  }
}
