import { W3cTraceParentTracer } from './w3cTraceParentTracer'

describe('w3cTraceParentTracer', () => {
  it('should build a standard traceparent header', () => {
    const tracer = new W3cTraceParentTracer({}, true, false)

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.getSpanId()).toMatch(/^[0-9a-f]{16}$/)
    expect(tracer.getTraceId()).toMatch(/^[0-9a-f]{32}$/)
    expect(tracer.makeTracingHeaders()).toEqual({
      traceparent: tracer.getTraceParent()
    })
  })

  it('should build gc headers when using the 64-bit mode', () => {
    const tracer = new W3cTraceParentTracer(
      {
        generateTraceId: () => '123456'
      },
      false,
      true
    )

    expect(tracer.getTraceId()).toBe('123456')
    expect(tracer.makeTracingHeaders()).toEqual({
      traceparent: tracer.getTraceParent(),
      'x-gc-trace-id': '123456',
      'x-gc-span-id': tracer.getSpanId()
    })
  })
})
