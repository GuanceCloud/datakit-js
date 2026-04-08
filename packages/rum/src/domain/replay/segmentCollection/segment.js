import { assign } from '@cloudcare/browser-core'
import { IncrementalSource, RecordType } from '../../../types'
import * as replayStats from '../replayStats'

export function createSegment(options) {
  const context = options.context
  const creationReason = options.creationReason
  const encoder = options.encoder
  let encodedBytesCount = 0
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
  replayStats.addSegment(viewId)
  function addRecord(record, callback) {
    metadata.start = Math.min(metadata.start, record.timestamp)
    metadata.end = Math.max(metadata.end, record.timestamp)
    metadata.records_count += 1
    incrementRecordCount(recordCountsByType, getRecordDebugType(record))
    if (!metadata.has_full_snapshot) {
      metadata.has_full_snapshot = record.type === RecordType.FullSnapshot
    }
    replayStats.addRecord(metadata.view.id)
    const prefix = encoder.isEmpty() ? '{"records":[' : ','
    encoder.write(
      prefix + JSON.stringify(record),
      function (additionalEncodedBytesCount) {
        encodedBytesCount += additionalEncodedBytesCount
        callback(encodedBytesCount)
      }
    )
  }
  function flush(callback) {
    if (encoder.isEmpty()) {
      throw new Error('Empty segment flushed')
    }
    encoder.write('],' + JSON.stringify(metadata).slice(1) + '\n')
    encoder.finish(function (encoderResult) {
      replayStats.addWroteData(metadata.view.id, encoderResult.rawBytesCount)
      callback(metadata, encoderResult, assign({}, recordCountsByType))
    })
  }
  return {
    addRecord: addRecord,
    flush: flush
  }
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
