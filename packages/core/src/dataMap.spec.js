import { commonFields, commonTags, dataMap } from './dataMap'
import { RumEventType } from './helper/enums'

describe('dataMap', () => {
  it('should expose shared common tags and fields', () => {
    expect(commonTags.sdk_name).toBe('_gc.sdk_name')
    expect(commonTags.userid).toBe('user.id')
    expect(commonTags.browser_version_major).toBe('device.browser_version_major')
    expect(commonFields.action_id).toBe('action.id')
    expect(commonFields.session_replay_sample_rate).toBe(
      '_gc.configuration.session_replay_sample_rate'
    )
  })

  it('should map rum event types to their expected payload definitions', () => {
    expect(dataMap.view.type).toBe(RumEventType.VIEW)
    expect(dataMap.resource.type).toBe(RumEventType.RESOURCE)
    expect(dataMap.error.type).toBe(RumEventType.ERROR)
    expect(dataMap.long_task.type).toBe(RumEventType.LONG_TASK)
    expect(dataMap.action.type).toBe(RumEventType.ACTION)
    expect(dataMap.browser_log.type).toBe(RumEventType.LOGGER)
  })

  it('should keep typed fields for string-normalized payload attributes', () => {
    expect(dataMap.error.fields.error_message).toEqual(['string', 'error.message'])
    expect(dataMap.long_task.fields.scripts).toEqual(['string', 'long_task.scripts'])
    expect(dataMap.telemetry.fields.message).toEqual(['string', 'telemetry.message'])
    expect(dataMap.browser_log.fields.message).toEqual(['string', 'message'])
  })

  it('should expose key resource and view mappings used by assembly code', () => {
    expect(dataMap.resource.tags.resource_status_group).toBe(
      'resource.status_group'
    )
    expect(dataMap.resource.fields.resource_url_path_group).toBe(
      'resource.url_path_group'
    )
    expect(dataMap.view.fields.first_contentful_paint).toBe(
      'view.first_contentful_paint'
    )
    expect(dataMap.view.fields.custom_timings).toBe('view.custom_timings')
  })
})
