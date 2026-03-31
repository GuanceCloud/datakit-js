import { JaegerTracer } from './jaegerTracer'

describe('jaegerTracer', () => {
  it('should build jaeger tracing headers', () => {
    const tracer = new JaegerTracer({}, true)

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.getSpanId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.getTraceId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.makeTracingHeaders()['uber-trace-id']).toContain(':')
  })

  it('should support 128-bit and custom trace ids', () => {
    const customTracer = new JaegerTracer(
      {
        traceId128Bit: true,
        generateTraceId: () => 'custom-jaeger-id'
      },
      false
    )

    expect(customTracer.getTraceId()).toBe('custom-jaeger-id')
    expect(customTracer.getUberTraceId().endsWith(':0')).toBeTrue()
  })
})
