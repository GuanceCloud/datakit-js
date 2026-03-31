import { TraceType } from '@cloudcare/browser-core'
import {
  isTracingOption,
  clearTracingIfNeeded,
  startTracer
} from './tracer'

describe('tracer', () => {
  it('should validate tracing options', () => {
    expect(
      isTracingOption({
        match: /api/,
        traceType: TraceType.DDTRACE
      })
    ).toBeTrue()
    expect(
      isTracingOption({
        match: 'https://example.com'
      })
    ).toBeFalse()
    expect(isTracingOption('invalid')).toBeFalse()
  })

  it('should clear tracing identifiers only for pending non-aborted requests', () => {
    const context = {
      status: 0,
      isAborted: false,
      traceId: 'trace-id',
      spanId: 'span-id',
      traceSampled: true
    }

    clearTracingIfNeeded(context)

    expect(context.traceId).toBeUndefined()
    expect(context.spanId).toBeUndefined()
    expect(context.traceSampled).toBeUndefined()

    const keptContext = {
      status: 500,
      isAborted: false,
      traceId: 'trace-id',
      spanId: 'span-id',
      traceSampled: false
    }
    clearTracingIfNeeded(keptContext)
    expect(keptContext.traceId).toBe('trace-id')
  })

  it('should inject fetch tracing headers and custom headers when allowed', () => {
    const tracer = startTracer(
      {
        allowedTracingUrls: [
          {
            match: 'https://example.com/api',
            traceType: TraceType.DDTRACE
          }
        ],
        tracingSampleRate: 100,
        injectTraceHeader: (context) => ({
          'x-extra-trace': context.url
        })
      },
      {
        findTrackedSession: () => ({
          id: '00000000-0000-0000-0000-000000000001'
        })
      }
    )
    const context = {
      url: 'https://example.com/api/orders',
      input: new Request('https://example.com/api/orders'),
      init: undefined
    }

    tracer.traceFetch(context)

    expect(context.traceId).toEqual(jasmine.any(String))
    expect(context.spanId).toEqual(jasmine.any(String))
    expect(context.traceSampled).toBeTrue()
    expect(context.input.headers.get('x-datadog-origin')).toBe('rum')
    expect(context.input.headers.get('x-extra-trace')).toBe(
      'https://example.com/api/orders'
    )
  })

  it('should inject xhr headers only when url matches and a session exists', () => {
    const tracer = startTracer(
      {
        allowedTracingUrls: [
          {
            match: /allowed/,
            traceType: TraceType.W3C_TRACEPARENT
          }
        ],
        tracingSampleRate: 100
      },
      {
        findTrackedSession: () => ({
          id: '00000000-0000-0000-0000-000000000001'
        })
      }
    )
    const xhr = {
      setRequestHeader: jasmine.createSpy('setRequestHeader')
    }

    tracer.traceXhr(
      {
        url: 'https://example.com/allowed'
      },
      xhr
    )
    expect(xhr.setRequestHeader).toHaveBeenCalled()

    xhr.setRequestHeader.calls.reset()
    tracer.traceXhr(
      {
        url: 'https://example.com/blocked'
      },
      xhr
    )
    expect(xhr.setRequestHeader).not.toHaveBeenCalled()
  })
})
