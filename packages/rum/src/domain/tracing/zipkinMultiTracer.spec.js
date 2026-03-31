import { ZipkinMultiTracer } from './zipkinMultiTracer'

describe('zipkinMultiTracer', () => {
  it('should build multi-header zipkin tracing headers', () => {
    const tracer = new ZipkinMultiTracer({}, true)

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.makeTracingHeaders()).toEqual({
      'X-B3-TraceId': tracer.getTraceId(),
      'X-B3-SpanId': tracer.getSpanId(),
      'X-B3-Sampled': '1'
    })
  })

  it('should support custom and 128-bit trace ids', () => {
    const tracer = new ZipkinMultiTracer(
      {
        traceId128Bit: true,
        generateTraceId: () => 'zipkin-custom-id'
      },
      false
    )

    expect(tracer.getTraceId()).toBe('zipkin-custom-id')
    expect(tracer.makeTracingHeaders()['X-B3-Sampled']).toBe('0')
  })
})
