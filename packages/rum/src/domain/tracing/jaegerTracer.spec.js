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
    const random128Tracer = new JaegerTracer(
      {
        traceId128Bit: true
      },
      true
    )
    const customTracer = new JaegerTracer(
      {
        generateTraceId: () => 'ABCDEF1234567890ABCDEF1234567890'
      },
      false
    )

    const invalidCustomTracer = new JaegerTracer(
      {
        generateTraceId: () => 'custom-jaeger-id'
      },
      false
    )

    expect(random128Tracer.getTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(random128Tracer.getTraceId().startsWith('0000000000000000')).toBeFalse()
    expect(customTracer.getTraceId()).toBe('abcdef1234567890abcdef1234567890')
    expect(invalidCustomTracer.getTraceId()).toMatch(/^[0-9a-f]{16}$/)
    expect(customTracer.getUberTraceId().endsWith(':0')).toBeTrue()
  })
})
