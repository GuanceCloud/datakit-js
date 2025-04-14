export var MAX_STATS_HISTORY = 10
var statsPerView

export function getSegmentsCount(viewId) {
  return getOrCreateReplayStats(viewId).segments_count
}

export function addSegment(viewId) {
  getOrCreateReplayStats(viewId).segments_count += 1
}

export function addRecord(viewId) {
  getOrCreateReplayStats(viewId).records_count += 1
}

export function addWroteData(viewId, additionalBytesCount) {
  getOrCreateReplayStats(viewId).segments_total_raw_size += additionalBytesCount
}

export function getReplayStats(viewId) {
  return statsPerView && statsPerView.get(viewId)
}

export function resetReplayStats() {
  statsPerView = undefined
}

function getOrCreateReplayStats(viewId) {
  if (!statsPerView) {
    statsPerView = new Map()
  }

  var replayStats
  if (statsPerView.has(viewId)) {
    replayStats = statsPerView.get(viewId)
  } else {
    replayStats = {
      records_count: 0,
      segments_count: 0,
      segments_total_raw_size: 0
    }
    statsPerView.set(viewId, replayStats)
    if (statsPerView.size > MAX_STATS_HISTORY) {
      deleteOldestStats()
    }
  }

  return replayStats
}

export function deleteOldestStats() {
  if (!statsPerView) {
    return
  }
  if (statsPerView.keys) {
    statsPerView.delete(statsPerView.keys().next().value)
  } else {
    // IE11 doesn't support map.keys
    var isFirst = true
    statsPerView.forEach(function (_value, key) {
      if (isFirst) {
        statsPerView.delete(key)
        isFirst = false
      }
    })
  }
}
