import { DDtraceTracer } from './ddtraceTracer'

describe('ddtraceTracer', () => {
  it('should build datadog tracing headers', () => {
    const tracer = new DDtraceTracer({}, true)

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.getSpanId()).toMatch(/^\d+$/)
    expect(tracer.getTraceId()).toMatch(/^\d+$/)
    expect(tracer.makeTracingHeaders()).toEqual({
      'x-datadog-origin': 'rum',
      'x-datadog-parent-id': tracer.getSpanId(),
      'x-datadog-sampling-priority': '2',
      'x-datadog-trace-id': tracer.getTraceId()
    })
  })

  it('should use a custom trace id when provided', () => {
    const tracer = new DDtraceTracer(
      {
        generateTraceId: () => 'custom-trace-id'
      },
      false
    )

    expect(tracer.getTraceId()).toBe('custom-trace-id')
    expect(tracer.makeTracingHeaders()['x-datadog-sampling-priority']).toBe('-1')
  })
})
