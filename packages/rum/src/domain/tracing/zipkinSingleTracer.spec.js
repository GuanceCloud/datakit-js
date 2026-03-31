import { ZipkinSingleTracer } from './zipkinSingleTracer'

describe('zipkinSingleTracer', () => {
  it('should build the compact b3 header', () => {
    const tracer = new ZipkinSingleTracer({}, true)

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.getSpanId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.getTraceId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.makeTracingHeaders()).toEqual({
      b3: tracer.getB3Str()
    })
  })

  it('should use a custom trace id when provided', () => {
    const tracer = new ZipkinSingleTracer(
      {
        generateTraceId: () => 'zipkin-single-custom-id'
      },
      false
    )

    expect(tracer.getTraceId()).toBe('zipkin-single-custom-id')
    expect(tracer.getB3Str().endsWith('-0')).toBeTrue()
  })
})
