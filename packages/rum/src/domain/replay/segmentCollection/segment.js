import { assign } from '@cloudcare/browser-core'
import { RecordType } from '../../../types'
import * as replayStats from '../replayStats'

export function createSegment(options) {
  const context = options.context
  const creationReason = options.creationReason
  const encoder = options.encoder
  let encodedBytesCount = 0
  const viewId = context.view.id

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
      callback(metadata, encoderResult)
    })
  }
  return {
    addRecord: addRecord,
    flush: flush
  }
}
