import { getEventBridge } from '@cloudcare/browser-core'

export function startRecordBridge(viewHistory) {
  const bridge = getEventBridge()

  return {
    addRecord: (record) => {
      // Get the current active view, not at the time of the record, aligning with the segment logic.
      // This approach could potentially associate the record to an incorrect view, in case the record date is in the past (e.g. frustration records).
      const view = viewHistory.findView()
      bridge.send('session_replay', record, view.id)
    }
  }
}
