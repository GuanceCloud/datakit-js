import { UUID, assign, deepClone, addTelemetryError } from '@cloudcare/browser-core'

var RESOURCE_TRACKER_HEADER = 'x-rum-resource-id'
var RESOURCE_TRACKER_TIMEOUT_MS = 30 * 1000
var RESOURCE_TRACKER_RETENTION_MS = 60 * 1000
var RESOURCE_TRACKER_ORPHAN_TTL_MS = 5 * 60 * 1000
var DEBUG_CLONE_MAX_DEPTH = 8

export function createResourceTrackerManager() {
  var trackers = new Map()
  var flushTrackedResource

  return {
    createTrackerId: function () {
      var trackerId = UUID()
      getOrCreateTracker(trackerId)
      return trackerId
    },
    setResourceContext: function (trackerId, context) {
      var tracker = trackers.get(trackerId)
      if (!tracker) {
        return
      }
      if (isTrackerImmutable(tracker)) {
        return
      }
      tracker.context = assign({}, context || {})
    },
    appendResourceContext: function (trackerId, context) {
      var tracker = trackers.get(trackerId)
      if (!tracker) {
        return
      }
      if (isTrackerImmutable(tracker)) {
        return
      }
      tracker.context = assign(tracker.context, context || {})
    },
    finishResource: function (trackerId) {
      var tracker = trackers.get(trackerId)
      if (!tracker) {
        return
      }
      tracker.finished = true
      if (tracker.status === 'request_collected') {
        flushTracker(tracker, 'flushed')
      } else if (tracker.status === 'created') {
        tracker.status = 'finished'
      }
    },
    getResource: function (trackerId) {
      var tracker = trackers.get(trackerId)
      if (!tracker) {
        return undefined
      }
      return cloneTrackerSnapshot(tracker)
    },
    trackRequestResource: function (trackerId, rawEvent) {
      var tracker = trackers.get(trackerId)
      if (!tracker) {
        return false
      }
      if (tracker.requestHeaderMatched || tracker.flushed) {
        return false
      }

      clearTrackerTimeout(tracker)
      tracker.requestHeaderMatched = true
      tracker.rawResourceEvent = rawEvent.rawRumEvent
      tracker.startTime = rawEvent.startTime
      tracker.domainContext = rawEvent.domainContext
      tracker.resource = extractResourceSummary(rawEvent.rawRumEvent)
      tracker.status = 'request_collected'

      if (tracker.finished) {
        flushTracker(tracker, 'flushed')
      } else {
        tracker.timeoutId = setTimeout(function () {
          tracker.timeoutId = undefined
          if (tracker.status === 'request_collected') {
            flushTracker(tracker, 'timeout_flushed')
          }
        }, RESOURCE_TRACKER_TIMEOUT_MS)
      }

      return true
    },
    setFlushTrackedResource: function (handler) {
      flushTrackedResource = handler
    },
    getTrackerIdFromRequestHeaders: function (requestHeaders) {
      return getHeaderValue(requestHeaders, RESOURCE_TRACKER_HEADER)
    }
  }

  function getOrCreateTracker(trackerId) {
    var tracker = trackers.get(trackerId)
    if (!tracker) {
      tracker = {
        id: trackerId,
        status: 'created',
        context: {},
        finished: false,
        flushed: false,
        requestHeaderMatched: false
      }
      trackers.set(trackerId, tracker)
      tracker.orphanTimeoutId = setTimeout(function () {
        tracker.status = 'cleared'
        trackers.delete(tracker.id)
      }, RESOURCE_TRACKER_ORPHAN_TTL_MS)
    }
    return tracker
  }

  function flushTracker(tracker, status) {
    if (tracker.flushed || !tracker.rawResourceEvent) {
      tracker.status = status
      return
    }

    clearTrackerTimeout(tracker)
    tracker.flushed = true
    tracker.status = status

    if (!flushTrackedResource) {
      scheduleTrackerClear(tracker)
      return
    }

    try {
      flushTrackedResource({
        startTime: tracker.startTime,
        rawRumEvent: tracker.rawResourceEvent,
        customerContext: assign({}, tracker.context),
        domainContext: tracker.domainContext
      })
    } catch (error) {
      addTelemetryError(error)
    } finally {
      scheduleTrackerClear(tracker)
    }
  }

  function scheduleTrackerClear(tracker) {
    clearTrackerTimeout(tracker)
    tracker.clearTimeoutId = setTimeout(function () {
      tracker.status = 'cleared'
      trackers.delete(tracker.id)
    }, RESOURCE_TRACKER_RETENTION_MS)
  }
}

function clearTrackerTimeout(tracker) {
  if (tracker.timeoutId) {
    clearTimeout(tracker.timeoutId)
    tracker.timeoutId = undefined
  }
  if (tracker.orphanTimeoutId) {
    clearTimeout(tracker.orphanTimeoutId)
    tracker.orphanTimeoutId = undefined
  }
  if (tracker.clearTimeoutId) {
    clearTimeout(tracker.clearTimeoutId)
    tracker.clearTimeoutId = undefined
  }
}

function isTrackerImmutable(tracker) {
  return (
    tracker.status === 'flushed' ||
    tracker.status === 'timeout_flushed' ||
    tracker.status === 'cleared'
  )
}

function extractResourceSummary(rawRumEvent) {
  var resource = rawRumEvent && rawRumEvent.resource
  if (!resource) {
    return undefined
  }

  return {
    type: resource.type,
    url: resource.url,
    method: resource.method,
    status: resource.status
  }
}

function cloneTrackerSnapshot(tracker) {
  return {
    trackerId: tracker.id,
    status: tracker.status,
    context: deepClone(tracker.context),
    resource: tracker.resource ? assign({}, tracker.resource) : undefined,
    rawRumEvent: tracker.rawResourceEvent
      ? cloneDebugRawRumEvent(tracker.rawResourceEvent)
      : undefined
  }
}

function cloneDebugRawRumEvent(rawRumEvent) {
  var clonedEvent = {}
  for (var key in rawRumEvent) {
    if (Object.prototype.hasOwnProperty.call(rawRumEvent, key)) {
      clonedEvent[key] = cloneDebugObject(rawRumEvent[key], DEBUG_CLONE_MAX_DEPTH)
    }
  }
  return clonedEvent
}

function cloneDebugObject(value, depth) {
  if (!value || typeof value !== 'object' || depth < 0) {
    return value
  }

  if (Array.isArray(value)) {
    var clonedArray = []
    for (var i = 0; i < value.length; i += 1) {
      clonedArray.push(cloneDebugObject(value[i], depth - 1))
    }
    return clonedArray
  }

  var clonedObject = {}
  for (var key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      clonedObject[key] = cloneDebugObject(value[key], depth - 1)
    }
  }
  return clonedObject
}

function getHeaderValue(headers, key) {
  if (!headers || !key) {
    return undefined
  }

  var normalizedKey = String(key).toLowerCase()

  if (typeof headers.get === 'function') {
    return headers.get(key) || headers.get(normalizedKey) || undefined
  }

  if (Array.isArray(headers)) {
    for (var i = 0; i < headers.length; i += 1) {
      var entry = headers[i]
      if (
        Array.isArray(entry) &&
        String(entry[0]).toLowerCase() === normalizedKey
      ) {
        return entry[1]
      }
    }
    return undefined
  }

  for (var headerKey in headers) {
    if (String(headerKey).toLowerCase() === normalizedKey) {
      return headers[headerKey]
    }
  }
}
