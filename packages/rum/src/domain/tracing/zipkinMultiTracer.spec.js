import { ZipkinMultiTracer } from './zipkinMultiTracer'

describe('zipkinMultiTracer', () => {
  it('should build multi-header zipkin tracing headers', () => {
    const tracer = new ZipkinMultiTracer({}, true)

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.getTraceId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.getSpanId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.makeTracingHeaders()).toEqual({
      'X-B3-TraceId': tracer.getTraceId(),
      'X-B3-SpanId': tracer.getSpanId(),
      'X-B3-Sampled': '1'
    })
  })

  it('should generate a true 128-bit trace id when enabled', () => {
    const tracer = new ZipkinMultiTracer(
      {
        traceId128Bit: true
      },
      false
    )

    expect(tracer.getTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(tracer.getTraceId().startsWith('0000000000000000')).toBeFalse()
    expect(tracer.makeTracingHeaders()['X-B3-Sampled']).toBe('0')
  })

  it('should normalize valid custom trace ids and ignore invalid ones', () => {
    const tracer = new ZipkinMultiTracer(
      {
        generateTraceId: () => 'ABCDEF1234567890'
      },
      false
    )

    const invalidTracer = new ZipkinMultiTracer(
      {
        generateTraceId: () => 'zipkin-custom-id'
      },
      false
    )

    expect(tracer.getTraceId()).toBe('abcdef1234567890')
    expect(invalidTracer.getTraceId()).toMatch(/^[0-9a-f]{16}$/)
  })
})
