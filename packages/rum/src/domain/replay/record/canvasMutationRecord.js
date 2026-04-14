import { IncrementalSource, RecordType } from '../../../types'

export function createCanvasMutationRecord(options) {
  var record = {
    type: RecordType.IncrementalSnapshot,
    timestamp: options.timestamp,
    data: {
      source: IncrementalSource.CanvasMutation,
      id: options.id,
      type: options.contextType || '2D',
      commands: options.commands
    }
  }

  if (typeof options.startedAt === 'number') {
    record.startedAt = options.startedAt
  }
  if (typeof options.completedAt === 'number') {
    record.completedAt = options.completedAt
  }

  return record
}

export function createEncodedCanvasMutationRecord(options) {
  var record = createCanvasMutationRecord(options)
  record.data.encodedBytesCount = options.encodedBytesCount
  return record
}
