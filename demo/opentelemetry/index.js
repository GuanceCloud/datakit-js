import { Resource } from '@opentelemetry/resources'
import {
  BatchSpanProcessor,
  WebTracerProvider
} from '@opentelemetry/sdk-trace-web'
import { ZoneContextManager } from '@opentelemetry/context-zone'
import { trace } from '@opentelemetry/api'
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto'

const setupOTelSDK = () => {
  const resource = Resource.default().merge(
    new Resource({
      'service.name': 'DigiFinex_Browser'
    })
  )

  const tracerProvider = new WebTracerProvider({ resource })

  const traceExporter = new OTLPTraceExporter({
    url: 'http://8.153.107.77:9529/otel/v1/traces',
    headers: {}
  })

  const spanProcessor = new BatchSpanProcessor(traceExporter)

  tracerProvider.addSpanProcessor(spanProcessor)

  // ⚠️ 注意！一定要设置 contextManager
  tracerProvider.register({
    contextManager: new ZoneContextManager()
  })

  trace.setGlobalTracerProvider(tracerProvider)
}

const createRootSpan = (spanName) => {
  const tracer = trace.getTracer('example-tracer')
  const rootSpan = tracer.startSpan(spanName)
  rootSpan.end()
  return rootSpan
}

export { setupOTelSDK, createRootSpan }

setupOTelSDK()

document.getElementById('button1').addEventListener('click', function () {
  const rootSpan = createRootSpan('button1-click')
  // 获取 spanContext
  const { traceId, spanId, traceFlags } = rootSpan.spanContext()

  // 构造 traceparent header
  const traceparent = `00-${traceId}-${spanId}-${traceFlags
    .toString(16)
    .padStart(2, '0')}`

  console.log('traceparent header:', traceparent)
})
