import { runOnReadyState, assign } from '@cloudcare/browser-core'
import { RumPerformanceEntryType } from '../../performanceObservable'
import { FAKE_INITIAL_DOCUMENT } from './resourceUtils'
import { getNavigationEntry } from '../../performanceUtils'
export function retrieveInitialDocumentResourceTiming(configuration, callback) {
  runOnReadyState('interactive', function () {
    var entry = assign(getNavigationEntry().toJSON(), {
      entryType: RumPerformanceEntryType.RESOURCE,
      initiatorType: FAKE_INITIAL_DOCUMENT,
      toJSON: function () {
        return assign({}, entry, { toJSON: undefined })
      }
    })
    callback(entry)
  })
}
