import { SkyWalkingTracer } from './skywalkingTracer'

describe('skywalkingTracer', () => {
  it('should build an sw8 tracing header', () => {
    const tracer = new SkyWalkingTracer(
      {
        applicationId: 'app-1',
        env: 'prod',
        version: '1.0.0'
      },
      'https://example.com/api/orders',
      true
    )

    expect(tracer.isTracingSupported()).toBeTrue()
    expect(tracer.getTraceId()).toEqual(jasmine.any(String))
    const sw8 = tracer.makeTracingHeaders().sw8

    expect(sw8.startsWith('1-')).toBeTrue()
    expect(sw8).toContain(btoa('app-1_rum_prod'))
  })

  it('should use a custom trace id when provided', () => {
    const tracer = new SkyWalkingTracer(
      {
        applicationId: 'app-1',
        env: 'prod',
        version: '1.0.0',
        generateTraceId: () => 'custom-skywalking-id'
      },
      'https://example.com/api/orders',
      false
    )

    expect(tracer.getTraceId()).toBe('custom-skywalking-id')
    expect(tracer.makeTracingHeaders().sw8.startsWith('0-')).toBeTrue()
  })
})
