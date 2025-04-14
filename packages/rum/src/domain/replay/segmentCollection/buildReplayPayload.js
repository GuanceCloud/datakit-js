import { objectEntries, each } from '@cloudcare/browser-core'

export function buildReplayPayload(data, metadata, rawSegmentBytesCount) {
  var formData = new FormData()
  formData.append(
    'segment',
    new Blob([data], {
      type: 'application/octet-stream'
    }),
    metadata.session.id + '-' + metadata.start
  )

  toFormEntries(metadata, function (key, value) {
    formData.append(key, value)
  })
  formData.append('raw_segment_size', rawSegmentBytesCount)

  return { data: formData, bytesCount: data.byteLength }
}

export function toFormEntries(input, onEntry, prefix) {
  if (prefix === undefined) {
    prefix = ''
  }
  each(objectEntries(input), function (item) {
    var value = item[1]
    var key = item[0]
    if (typeof value === 'object' && value !== null) {
      toFormEntries(value, onEntry, '' + prefix + key + '_')
    } else {
      onEntry('' + prefix + key, String(value))
    }
  })
}
