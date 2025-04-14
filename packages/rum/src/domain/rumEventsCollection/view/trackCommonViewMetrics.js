import { trackScrollMetrics } from './trackScrollMetrics'
import { trackLoadingTime } from './trackLoadingTime'
import { trackCumulativeLayoutShift } from './trackCumulativeLayoutShift'
import { trackInteractionToNextPaint } from './trackInteractionToNextPaint'

export function trackCommonViewMetrics(
  lifeCycle,
  domMutationObservable,
  configuration,
  scheduleViewUpdate,
  loadingType,
  viewStart
) {
  var commonViewMetrics = {}
  var _trackLoadingTime = trackLoadingTime(
    lifeCycle,
    domMutationObservable,
    configuration,
    loadingType,
    viewStart,
    function (newLoadingTime) {
      commonViewMetrics.loadingTime = newLoadingTime
      scheduleViewUpdate()
    }
  )
  var stopLoadingTimeTracking = _trackLoadingTime.stop
  var setLoadEvent = _trackLoadingTime.setLoadEvent
  var _trackScrollMetrics = trackScrollMetrics(
    configuration,
    viewStart,
    function (newScrollMetrics) {
      commonViewMetrics.scroll = newScrollMetrics
    }
  )
  var stopScrollMetricsTracking = _trackScrollMetrics.stop
  var stopCLSTracking
  var _trackCumulativeLayoutShift = trackCumulativeLayoutShift(
    configuration,
    viewStart.relative,
    function (cumulativeLayoutShift) {
      commonViewMetrics.cumulativeLayoutShift = cumulativeLayoutShift
      scheduleViewUpdate()
    }
  )
  var stopCLSTracking = _trackCumulativeLayoutShift.stop
  var _trackInteractionToNextPaint = trackInteractionToNextPaint(
    configuration,
    viewStart.relative,
    loadingType
  )
  var stopINPTracking = _trackInteractionToNextPaint.stop
  var getInteractionToNextPaint =
    _trackInteractionToNextPaint.getInteractionToNextPaint
  var setViewEnd = _trackInteractionToNextPaint.setViewEnd
  return {
    stop: function () {
      stopLoadingTimeTracking()
      stopCLSTracking()
      stopScrollMetricsTracking()
    },
    stopINPTracking: stopINPTracking,
    setLoadEvent: setLoadEvent,
    setViewEnd: setViewEnd,
    getCommonViewMetrics: function () {
      commonViewMetrics.interactionToNextPaint = getInteractionToNextPaint()
      return commonViewMetrics
    }
  }
}
