import { relativeNow, ONE_MINUTE, removeItem, addDuration } from './tools'
import { setInterval, clearInterval } from './timer'
var END_OF_TIMES = Infinity

export var CLEAR_OLD_VALUES_INTERVAL = ONE_MINUTE
let cleanupHistoriesInterval = null

const cleanupTasks = new Set()

function cleanupHistories() {
  cleanupTasks.forEach((task) => task())
}
/**
 *
 * @param {expireDelay,maxEntries } params
 * @returns
 */
export function createValueHistory(params) {
  var expireDelay = params.expireDelay
  var maxEntries = params.maxEntries

  var entries = []
  if (cleanupHistoriesInterval) {
    cleanupHistoriesInterval = setInterval(function () {
      return clearExpiredValues()
    }, CLEAR_OLD_VALUES_INTERVAL)
  }

  function clearExpiredValues() {
    var oldTimeThreshold = relativeNow() - expireDelay
    while (
      entries.length > 0 &&
      entries[entries.length - 1].endTime < oldTimeThreshold
    ) {
      entries.pop()
    }
  }
  cleanupTasks.add(clearExpiredValues)
  function add(value, startTime) {
    var entry = {
      value: value,
      startTime: startTime,
      endTime: END_OF_TIMES,
      remove: function () {
        removeItem(entries, entry)
      },
      close: function (endTime) {
        entry.endTime = endTime
      }
    }

    if (maxEntries && entries.length >= maxEntries) {
      entries.pop()
    }

    entries.unshift(entry)

    return entry
  }

  function find(startTime, options) {
    if (typeof startTime === 'undefined') {
      startTime = END_OF_TIMES
    }
    if (typeof options === 'undefined') {
      options = { returnInactive: false }
    }
    for (var _i = 0, entries_1 = entries; _i < entries_1.length; _i++) {
      var entry = entries_1[_i]
      if (entry.startTime <= startTime) {
        if (options.returnInactive || startTime <= entry.endTime) {
          return entry.value
        }
        break
      }
    }
  }

  function closeActive(endTime) {
    var latestEntry = entries[0]
    if (latestEntry && latestEntry.endTime === END_OF_TIMES) {
      latestEntry.close(endTime)
    }
  }

  function findAll(startTime, duration) {
    if (startTime === undefined) {
      startTime = END_OF_TIMES
    }
    if (duration === undefined) {
      duration = 0
    }
    var endTime = addDuration(startTime, duration)
    return entries
      .filter(function (entry) {
        return entry.startTime <= endTime && startTime <= entry.endTime
      })
      .map(function (entry) {
        return entry.value
      })
  }

  /**
   * Remove all entries from this collection.
   */
  function reset() {
    entries = []
  }

  /**
   * Stop internal garbage collection of past entries.
   */
  function stop() {
    cleanupTasks.delete(clearExpiredValues)
    if (cleanupTasks.size === 0 && cleanupHistoriesInterval) {
      clearInterval(cleanupHistoriesInterval)
      cleanupHistoriesInterval = null
    }
  }

  return {
    add: add,
    find: find,
    closeActive: closeActive,
    findAll: findAll,
    reset: reset,
    stop: stop
  }
}
