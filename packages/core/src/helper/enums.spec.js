import {
  ActionType,
  DOM_EVENT,
  ErrorHandling,
  FrustrationType,
  NonErrorPrefix,
  RequestType,
  ResourceType,
  RumEventType,
  RumLongTaskEntryType,
  TraceType,
  ViewLoadingType
} from './enums'

describe('enums', () => {
  it('should expose key dom events and rum event types', () => {
    expect(DOM_EVENT.CLICK).toBe('click')
    expect(DOM_EVENT.VISIBILITY_CHANGE).toBe('visibilitychange')
    expect(RumEventType.VIEW).toBe('view')
    expect(RumEventType.LOGGER).toBe('logger')
  })

  it('should expose request, resource and long task types', () => {
    expect(ResourceType.FETCH).toBe('fetch')
    expect(ResourceType.CUSTOM).toBe('custom')
    expect(RequestType).toEqual({
      FETCH: 'fetch',
      XHR: 'xhr'
    })
    expect(RumLongTaskEntryType.LONG_TASK).toBe('long-task')
    expect(RumLongTaskEntryType.LONG_ANIMATION_FRAME).toBe(
      'long-animation-frame'
    )
  })

  it('should expose action, frustration, trace and error enums', () => {
    expect(ActionType.CLICK).toBe('click')
    expect(FrustrationType.RAGE_CLICK).toBe('rage_click')
    expect(ViewLoadingType.ROUTE_CHANGE).toBe('route_change')
    expect(TraceType.W3C_TRACEPARENT_64).toBe('w3c_traceparent_64bit')
    expect(ErrorHandling.HANDLED).toBe('handled')
    expect(NonErrorPrefix.UNCAUGHT).toBe('Uncaught')
  })
})
