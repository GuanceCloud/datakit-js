import { assign, timeStampNow } from '@cloudcare/browser-core'
import { RecordType } from '../../../types'

export function isTouchEvent(event) {
  return Boolean(event.changedTouches)
}

export function forEach(list, callback) {
  Array.prototype.forEach.call(list, callback)
}

export function assembleIncrementalSnapshot(source, data) {
  return {
    data: assign(
      {
        source: source
      },
      data
    ),
    type: RecordType.IncrementalSnapshot,
    timestamp: timeStampNow()
  }
}

export function getPathToNestedCSSRule(rule) {
  var path = []
  var currentRule = rule
  while (currentRule.parentRule) {
    var rules = Array.from(currentRule.parentRule.cssRules)
    var index = rules.indexOf(currentRule)
    path.unshift(index)
    currentRule = currentRule.parentRule
  }
  // A rule may not be attached to a stylesheet
  if (!currentRule.parentStyleSheet) {
    return
  }

  var rules = Array.from(currentRule.parentStyleSheet.cssRules)
  var index = rules.indexOf(currentRule)
  path.unshift(index)

  return path
}
