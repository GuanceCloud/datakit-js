export var SESSION_REPLAY_TIME_ANCHOR_INTERVAL = 60 * 1000
// Keep enough headroom for a final stateless anchor when the regular replay
// encoder backlog has reached its limit, without turning the exemption into an
// unbounded queue if the worker remains stalled.
export var SESSION_REPLAY_TIME_ANCHOR_BACKPRESSURE_RESERVE = 4 * 1024
// rrweb EventType.Custom. Keep this internal record wire-compatible without
// expanding the SDK's public RecordType contract.
export var SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE = 5
export var SESSION_REPLAY_TIME_ANCHOR_TAG =
  'rum-session-replay-time-anchor'

export function isSessionReplayTimeAnchor(record) {
  if (
    !record ||
    record.type !== SESSION_REPLAY_TIME_ANCHOR_RECORD_TYPE ||
    typeof record.timestamp !== 'number' ||
    !record.data ||
    record.data.tag !== SESSION_REPLAY_TIME_ANCHOR_TAG ||
    !record.data.payload
  ) {
    return false
  }
  // Only the fixed, state-free SDK record may bypass the shared encoder raw
  // backlog limit. A customer Custom event reusing the tag, adding fields or
  // carrying a payload must retain the normal non-incremental failure rules.
  return (
    Object.keys(record).length === 3 &&
    Object.keys(record.data).length === 2 &&
    typeof record.data.payload === 'object' &&
    !Array.isArray(record.data.payload) &&
    Object.keys(record.data.payload).length === 0
  )
}
