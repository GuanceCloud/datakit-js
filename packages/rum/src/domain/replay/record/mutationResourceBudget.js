export var MAX_GLOBAL_MUTATION_RECORDS = 4096
export var MAX_GLOBAL_MUTATION_NODES = 16384
export var MAX_GLOBAL_MUTATION_FLUSH_EVENTS = 4096
// Match the recorder's existing pending-admission ceiling. This keeps the
// cross-observer aggregate bounded without turning a previously healthy
// streamed 20-30 MiB split tail into a mandatory FullSnapshot.
export var MAX_GLOBAL_MUTATION_APPROX_BYTES = 32 * 1024 * 1024
export var MAX_GLOBAL_MUTATION_RETAINED_APPROX_BYTES = 32 * 1024 * 1024
export var MAX_GLOBAL_MUTATION_FLUSH_APPROX_BYTES = 32 * 1024 * 1024

var RECORD_COUNT = 0
var NODE_COUNT = 1
var EVENT_COUNT = 2
var APPROX_BYTES = 3
export var MUTATION_RESOURCE_RAW = 0
export var MUTATION_RESOURCE_RETAINED = 1
export var MUTATION_RESOURCE_FLUSH = 2

export function createMutationResourceBudget() {
  var generation = 0
  var failed = false
  var totalApproxBytes = 0
  var usageByKind = createEmptyUsageByKind()

  var budget = {
    reserve: reserve,
    failOnce: function () {
      if (failed) {
        return false
      }
      failed = true
      return true
    },
    isFailed: function () {
      return failed
    },
    reset: function () {
      generation += 1
      failed = false
      totalApproxBytes = 0
      usageByKind = createEmptyUsageByKind()
    }
  }
  if (__BUILD_ENV__REPLAY_DEBUG_ENABLED__) {
    budget.getUsage = function () {
      return {
        failed: failed,
        totalApproxBytes: totalApproxBytes,
        raw: toDebugMeasurement(usageByKind[MUTATION_RESOURCE_RAW]),
        retained: toDebugMeasurement(
          usageByKind[MUTATION_RESOURCE_RETAINED]
        ),
        flush: toDebugMeasurement(usageByKind[MUTATION_RESOURCE_FLUSH])
      }
    }
  }
  return budget

  function reserve(kind, measurement) {
    if (failed || !usageByKind[kind]) {
      return false
    }
    var normalizedMeasurement = normalizeMeasurement(measurement)
    if (!canApplyMeasurement(kind, normalizedMeasurement)) {
      return false
    }
    applyMeasurement(kind, normalizedMeasurement)
    var reservationGeneration = generation
    var released = false

    var release = function () {
      if (released) {
        return
      }
      released = true
      if (reservationGeneration !== generation) {
        return
      }
      applyMeasurement(kind, normalizedMeasurement, -1)
    }
    release.update = function (nextMeasurement) {
      if (released || reservationGeneration !== generation) {
        return false
      }
      var normalizedNextMeasurement = normalizeMeasurement(nextMeasurement)
      var delta = normalizedNextMeasurement.map(function (value, index) {
        return value - normalizedMeasurement[index]
      })
      if (
        hasPositiveMeasurement(delta) &&
        (failed || !canApplyMeasurement(kind, delta))
      ) {
        return false
      }
      applyMeasurement(kind, delta)
      normalizedMeasurement = normalizedNextMeasurement
      return true
    }
    return release
  }

  function canApplyMeasurement(kind, measurement) {
    var usage = usageByKind[kind]
    var nextApproxBytes = totalApproxBytes + measurement[APPROX_BYTES]
    if (
      nextApproxBytes > MAX_GLOBAL_MUTATION_APPROX_BYTES ||
      nextApproxBytes < 0
    ) {
      return false
    }
    if (
      kind === MUTATION_RESOURCE_RAW &&
      (usage[RECORD_COUNT] + measurement[RECORD_COUNT] >
        MAX_GLOBAL_MUTATION_RECORDS ||
        usage[NODE_COUNT] + measurement[NODE_COUNT] >
          MAX_GLOBAL_MUTATION_NODES)
    ) {
      return false
    }
    if (
      kind === MUTATION_RESOURCE_RETAINED &&
      usage[APPROX_BYTES] + measurement[APPROX_BYTES] >
        MAX_GLOBAL_MUTATION_RETAINED_APPROX_BYTES
    ) {
      return false
    }
    if (
      kind === MUTATION_RESOURCE_FLUSH &&
      (usage[EVENT_COUNT] + measurement[EVENT_COUNT] >
        MAX_GLOBAL_MUTATION_FLUSH_EVENTS ||
        usage[APPROX_BYTES] + measurement[APPROX_BYTES] >
          MAX_GLOBAL_MUTATION_FLUSH_APPROX_BYTES)
    ) {
      return false
    }
    return true
  }

  function applyMeasurement(kind, measurement, direction) {
    var usage = usageByKind[kind]
    direction = direction || 1
    for (var index = 0; index < usage.length; index += 1) {
      usage[index] = Math.max(
        usage[index] + measurement[index] * direction,
        0
      )
    }
    totalApproxBytes = Math.max(
      totalApproxBytes + measurement[APPROX_BYTES] * direction,
      0
    )
  }
}

function createEmptyUsageByKind() {
  return [
    [0, 0, 0, 0],
    [0, 0, 0, 0],
    [0, 0, 0, 0]
  ]
}

function normalizeMeasurement(measurement) {
  measurement = measurement || {}
  return [
    Math.max(measurement.recordCount || 0, 0),
    Math.max(measurement.nodeCount || 0, 0),
    Math.max(measurement.eventCount || 0, 0),
    Math.max(
      Number.isFinite(measurement.approxBytes)
        ? measurement.approxBytes
        : 0,
      0
    )
  ]
}

function toDebugMeasurement(measurement) {
  return {
    recordCount: measurement[RECORD_COUNT],
    nodeCount: measurement[NODE_COUNT],
    eventCount: measurement[EVENT_COUNT],
    approxBytes: measurement[APPROX_BYTES]
  }
}

function hasPositiveMeasurement(measurement) {
  return measurement.some(function (value) {
    return value > 0
  })
}
