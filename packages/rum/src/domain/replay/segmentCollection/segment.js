import { assign } from '@cloudcare/browser-core'
import { IncrementalSource, RecordType } from '../../../types'
import * as replayStats from '../replayStats'
import { getSerializedNodeApproxBytes } from '../record/serialize'

var MAX_RECORD_SERIALIZATION_DEPTH = 1000
var MAX_RECORD_PREFLIGHT_VALUES = 50000

export function createSegment(options) {
  const context = options.context
  const creationReason = options.creationReason
  const encoder = options.encoder
  let encodedBytesCount = 0
  let estimatedEncodedBytesCount = 0
  let isRegisteredInStats = false
  const viewId = context.view.id
  const recordCountsByType = {}

  const metadata = assign(
    {
      start: Infinity,
      end: -Infinity,
      creation_reason: creationReason,
      records_count: 0,
      has_full_snapshot: false,
      index_in_view: replayStats.getSegmentsCount(viewId),
      source: 'browser'
    },
    context
  )
  function addRecord(
    record,
    callback,
    bytesLimit,
    pendingRawBytesLimit,
    previouslySerializedRecordData
  ) {
    const prefix = metadata.records_count === 0 ? '{"records":[' : ','
    var preflightResult = preflightRecordSerialization(
      record,
      prefix,
      pendingRawBytesLimit
    )
    if (preflightResult) {
      return preflightResult
    }
    var fullSnapshotAdmissionResult = preflightFullSnapshotAdmission(
      record,
      prefix,
      metadata.records_count,
      estimatedEncodedBytesCount,
      bytesLimit,
      pendingRawBytesLimit,
      encoder
    )
    if (fullSnapshotAdmissionResult) {
      return fullSnapshotAdmissionResult
    }
    var serializedRecord
    var serializedRecordData = previouslySerializedRecordData
    try {
      if (typeof serializedRecordData !== 'string') {
        serializedRecordData = JSON.stringify(record)
      }
      if (typeof serializedRecordData !== 'string') {
        return createRecordTooLargeResult(pendingRawBytesLimit)
      }
      serializedRecord = prefix + serializedRecordData
    } catch (_) {
      return createRecordTooLargeResult(pendingRawBytesLimit)
    }
    const rawRecordBytesCount = serializedRecord.length * 2
    const estimatedRecordBytesCount = estimateRecordEncodedBytesCount(
      record,
      serializedRecord,
      encoder
    )

    if (
      pendingRawBytesLimit !== undefined &&
      rawRecordBytesCount > pendingRawBytesLimit
    ) {
      return {
        status: 'record_too_large',
        estimatedBytesCount: rawRecordBytesCount
      }
    }

    if (
      bytesLimit !== undefined &&
      isEncodedCanvasMutationRecord(record) &&
      estimatedRecordBytesCount > bytesLimit
    ) {
      // Bitmap canvas payloads are already image-compressed before their
      // base64/JSON envelope reaches the segment encoder. Unlike regular
      // replay records, the stream's generic compression estimate cannot make
      // an oversized bitmap record deliverable. Reject it synchronously
      // so the canvas observer can report the rejected frame instead of
      // publishing a record that will be discarded after finalization.
      return {
        status: 'record_too_large',
        estimatedBytesCount: estimatedRecordBytesCount
      }
    }

    if (
      bytesLimit !== undefined &&
      metadata.records_count > 0 &&
      estimatedEncodedBytesCount + estimatedRecordBytesCount > bytesLimit
    ) {
      return {
        status: 'segment_full',
        estimatedBytesCount: estimatedRecordBytesCount,
        serializedRecordData: serializedRecordData
      }
    }

    const pendingRawBytesCount = encoder.getPendingRawBytesCount
      ? encoder.getPendingRawBytesCount()
      : 0
    if (
      pendingRawBytesLimit !== undefined &&
      pendingRawBytesCount + rawRecordBytesCount > pendingRawBytesLimit
    ) {
      return {
        status: 'encoder_backpressure',
        estimatedBytesCount: rawRecordBytesCount,
        serializedRecordData: serializedRecordData
      }
    }

    if (!isRegisteredInStats) {
      replayStats.addSegment(viewId)
      isRegisteredInStats = true
    }
    metadata.start = Math.min(metadata.start, record.timestamp)
    metadata.end = Math.max(metadata.end, record.timestamp)
    metadata.records_count += 1
    incrementRecordCount(recordCountsByType, getRecordDebugType(record))
    if (!metadata.has_full_snapshot) {
      metadata.has_full_snapshot = record.type === RecordType.FullSnapshot
    }
    replayStats.addRecord(metadata.view.id)
    estimatedEncodedBytesCount += estimatedRecordBytesCount
    encoder.write(
      serializedRecord,
      function (additionalEncodedBytesCount, error) {
        if (error) {
          callback(encodedBytesCount, error)
          return
        }
        encodedBytesCount += additionalEncodedBytesCount
        estimatedEncodedBytesCount +=
          additionalEncodedBytesCount - estimatedRecordBytesCount
        callback(encodedBytesCount)
      }
    )
    return {
      status: 'added',
      estimatedBytesCount: estimatedEncodedBytesCount
    }
  }
  function flush(callback) {
    if (metadata.records_count === 0) {
      throw new Error('Empty segment flushed')
    }
    var footerWriteError
    encoder.write(
      '],' + JSON.stringify(metadata).slice(1) + '\n',
      function (_additionalEncodedBytesCount, error) {
        footerWriteError = error
      }
    )
    encoder.finish(function (encoderResult) {
      if (footerWriteError && !encoderResult.error) {
        encoderResult.error = footerWriteError
      }
      replayStats.addWroteData(metadata.view.id, encoderResult.rawBytesCount)
      callback(metadata, encoderResult, assign({}, recordCountsByType))
    })
  }
  function discard(callback) {
    if (encoder.$rFinishDiscard) {
      encoder.$rFinishDiscard(callback)
    } else {
      encoder.finish(callback)
    }
  }
  return {
    addRecord: addRecord,
    flush: flush,
    $rDiscard: discard,
    isEmpty: function () {
      return metadata.records_count === 0
    }
  }
}

function preflightFullSnapshotAdmission(
  record,
  prefix,
  recordsCount,
  estimatedEncodedBytesCount,
  bytesLimit,
  pendingRawBytesLimit,
  encoder
) {
  if (!record || record.type !== RecordType.FullSnapshot) {
    return
  }
  var knownApproxBytes = getKnownReplayRecordApproxBytes(record)
  if (typeof knownApproxBytes !== 'number') {
    return
  }
  var approximateRawBytes = prefix.length * 2 + knownApproxBytes
  var pendingRawBytesCount = encoder.getPendingRawBytesCount
    ? encoder.getPendingRawBytesCount()
    : 0
  if (
    pendingRawBytesLimit !== undefined &&
    pendingRawBytesCount + approximateRawBytes > pendingRawBytesLimit
  ) {
    return {
      status: 'encoder_backpressure',
      estimatedBytesCount: approximateRawBytes
    }
  }
  if (
    bytesLimit !== undefined &&
    recordsCount > 0 &&
    estimatedEncodedBytesCount > 0
  ) {
    var estimatedFullSnapshotBytesCount = encoder.estimateEncodedBytesCount
      ? encoder.estimateEncodedBytesCount(Math.ceil(approximateRawBytes / 2))
      : Math.ceil(approximateRawBytes / 2)
    if (
      estimatedEncodedBytesCount + estimatedFullSnapshotBytesCount >
      bytesLimit
    ) {
      return {
        status: 'segment_full',
        estimatedBytesCount: estimatedFullSnapshotBytesCount
      }
    }
  }
}

function preflightRecordSerialization(record, prefix, pendingRawBytesLimit) {
  if (pendingRawBytesLimit === undefined) {
    return
  }
  var remainingBytes = pendingRawBytesLimit - prefix.length * 2
  if (remainingBytes <= 0) {
    return createRecordTooLargeResult(pendingRawBytesLimit)
  }

  var knownApproxBytes = getKnownReplayRecordApproxBytes(record)
  if (knownApproxBytes !== undefined) {
    if (knownApproxBytes > remainingBytes) {
      return {
        status: 'record_too_large',
        estimatedBytesCount: prefix.length * 2 + knownApproxBytes
      }
    }
    return
  }

  var approxBytes = estimateJsonValueUpperBytes(record, remainingBytes)
  if (approxBytes > remainingBytes) {
    return {
      status: 'record_too_large',
      estimatedBytesCount: prefix.length * 2 + approxBytes
    }
  }
}

function getKnownReplayRecordApproxBytes(record) {
  if (
    record &&
    record.type === RecordType.FullSnapshot &&
    record.data &&
    record.data.node
  ) {
    var fullSnapshotNodeBytes = getSerializedNodeApproxBytes(record.data.node)
    if (typeof fullSnapshotNodeBytes === 'number') {
      return fullSnapshotNodeBytes + 512
    }
  }
  if (
    record &&
    record.type === RecordType.IncrementalSnapshot &&
    record.data &&
    record.data.source === IncrementalSource.Mutation
  ) {
    var mutationBytes = 512
    var adds = record.data.adds || []
    for (var addIndex = 0; addIndex < adds.length; addIndex += 1) {
      var addNodeBytes = getSerializedNodeApproxBytes(adds[addIndex].node)
      if (typeof addNodeBytes !== 'number') {
        return
      }
      mutationBytes += addNodeBytes + 64
    }
    mutationBytes += estimateMutationStrings(record.data.texts)
    mutationBytes += estimateMutationStrings(record.data.attributes)
    mutationBytes += (record.data.removes || []).length * 64
    return mutationBytes
  }
}

function estimateMutationStrings(entries) {
  var bytes = 0
  var pendingValues = (entries || []).slice()
  var visitedValues = 0
  while (pendingValues.length) {
    if (visitedValues >= MAX_RECORD_PREFLIGHT_VALUES) {
      return Number.MAX_SAFE_INTEGER
    }
    visitedValues += 1
    var value = pendingValues.pop()
    if (typeof value === 'string') {
      bytes += value.length * 12 + 4
    } else if (value && typeof value === 'object') {
      for (var key in value) {
        if (Object.prototype.hasOwnProperty.call(value, key)) {
          bytes += key.length * 12 + 4
          pendingValues.push(value[key])
        }
      }
    }
  }
  return bytes
}

function estimateJsonValueUpperBytes(rootValue, maxBytes) {
  var approxBytes = 0
  var processedValues = 0
  var ancestors = new WeakSet()
  var stack = [
    {
      type: 'value',
      value: rootValue,
      depth: 0,
      inArray: false
    }
  ]

  while (stack.length) {
    if (
      approxBytes > maxBytes ||
      processedValues >= MAX_RECORD_PREFLIGHT_VALUES
    ) {
      return maxBytes + 1
    }
    processedValues += 1
    var task = stack.pop()
    if (task.type === 'exit') {
      ancestors.delete(task.value)
      continue
    }
    var value = task.value
    if (typeof value === 'string') {
      approxBytes += value.length * 12 + 4
      continue
    }
    if (
      value === null ||
      typeof value === 'boolean' ||
      typeof value === 'number'
    ) {
      approxBytes += 16
      continue
    }
    if (
      typeof value === 'undefined' ||
      typeof value === 'function' ||
      typeof value === 'symbol'
    ) {
      approxBytes += task.inArray ? 8 : 0
      continue
    }
    if (typeof value === 'bigint' || task.depth >= MAX_RECORD_SERIALIZATION_DEPTH) {
      return maxBytes + 1
    }
    if (!value || typeof value !== 'object' || ancestors.has(value)) {
      return maxBytes + 1
    }
    if (typeof value.toJSON === 'function') {
      return maxBytes + 1
    }

    ancestors.add(value)
    stack.push({ type: 'exit', value: value })
    approxBytes += 4
    if (Array.isArray(value)) {
      if (value.length > MAX_RECORD_PREFLIGHT_VALUES) {
        return maxBytes + 1
      }
      approxBytes += Math.max(value.length - 1, 0) * 2
      for (var arrayIndex = value.length - 1; arrayIndex >= 0; arrayIndex -= 1) {
        stack.push({
          type: 'value',
          value: value[arrayIndex],
          depth: task.depth + 1,
          inArray: true
        })
      }
      continue
    }

    var propertyCount = 0
    try {
      for (var key in value) {
        if (!Object.prototype.hasOwnProperty.call(value, key)) {
          continue
        }
        var propertyValue = value[key]
        if (
          typeof propertyValue === 'undefined' ||
          typeof propertyValue === 'function' ||
          typeof propertyValue === 'symbol'
        ) {
          continue
        }
        propertyCount += 1
        if (propertyCount > MAX_RECORD_PREFLIGHT_VALUES) {
          return maxBytes + 1
        }
        approxBytes += key.length * 12 + 6
        if (propertyCount > 1) {
          approxBytes += 2
        }
        stack.push({
          type: 'value',
          value: propertyValue,
          depth: task.depth + 1,
          inArray: false
        })
      }
    } catch (_) {
      return maxBytes + 1
    }
  }
  return approxBytes
}

function createRecordTooLargeResult(pendingRawBytesLimit) {
  return {
    status: 'record_too_large',
    estimatedBytesCount:
      typeof pendingRawBytesLimit === 'number'
        ? pendingRawBytesLimit + 1
        : Number.MAX_SAFE_INTEGER
  }
}

function estimateRecordEncodedBytesCount(record, serializedRecord, encoder) {
  if (isEncodedCanvasMutationRecord(record)) {
    // Encoded canvas frames are already compressed image data represented as
    // base64. Deflate cannot achieve the generic replay stream's usual ratio,
    // so using the raw string length prevents oversized segments and reset
    // loops under high-frequency canvas capture.
    return serializedRecord.length
  }
  return encoder.estimateEncodedBytesCount
    ? encoder.estimateEncodedBytesCount(serializedRecord)
    : serializedRecord.length
}

function isEncodedCanvasMutationRecord(record) {
  return (
    record &&
    record.type === RecordType.IncrementalSnapshot &&
    record.data &&
    record.data.source === IncrementalSource.CanvasMutation &&
    typeof record.data.encodedBytesCount === 'number'
  )
}

function incrementRecordCount(recordCountsByType, recordDebugType) {
  recordCountsByType[recordDebugType] =
    (recordCountsByType[recordDebugType] || 0) + 1
}

function getRecordDebugType(record) {
  if (!record) {
    return 'other'
  }

  switch (record.type) {
    case RecordType.FullSnapshot:
      return 'full_snapshot'
    case RecordType.Meta:
      return 'meta'
    case RecordType.Focus:
      return 'focus'
    case RecordType.ViewEnd:
      return 'view_end'
    case RecordType.VisualViewport:
      return 'visual_viewport'
    case RecordType.FrustrationRecord:
      return 'frustration_record'
    case RecordType.IncrementalSnapshot:
      return getIncrementalRecordDebugType(record)
    default:
      return 'other'
  }
}

function getIncrementalRecordDebugType(record) {
  if (!record.data) {
    return 'incremental_unknown'
  }

  switch (record.data.source) {
    case IncrementalSource.Mutation:
      return 'mutation'
    case IncrementalSource.MouseMove:
      return 'mouse_move'
    case IncrementalSource.MouseInteraction:
      return 'mouse_interaction'
    case IncrementalSource.Scroll:
      return 'scroll'
    case IncrementalSource.ViewportResize:
      return 'viewport_resize'
    case IncrementalSource.Input:
      return 'input'
    case IncrementalSource.TouchMove:
      return 'touch_move'
    case IncrementalSource.MediaInteraction:
      return 'media_interaction'
    case IncrementalSource.StyleSheetRule:
      return 'style_sheet_rule'
    case IncrementalSource.CanvasMutation:
      return 'canvas_mutation'
    default:
      return 'incremental_unknown'
  }
}
