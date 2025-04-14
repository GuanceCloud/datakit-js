import { trackEventCounts } from '../../trackEventCounts'

export function trackViewEventCounts(lifeCycle, viewId, onChange) {
  var _trackEventCounts = trackEventCounts({
    lifeCycle: lifeCycle,
    isChildEvent: function (event) {
      return event.view.id === viewId
    },
    onChange: onChange
  })
  return {
    stop: _trackEventCounts.stop,
    eventCounts: _trackEventCounts.eventCounts
  }
}
