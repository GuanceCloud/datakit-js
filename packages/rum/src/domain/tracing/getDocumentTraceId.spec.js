import {
  createDocumentTraceData,
  findTraceComment,
  getDocumentTraceDataFromComment,
  getDocumentTraceDataFromMeta,
  getDocumentTraceId,
  INITIAL_DOCUMENT_OUTDATED_TRACE_ID_THRESHOLD
} from './getDocumentTraceId'

describe('getDocumentTraceId', () => {
  let originalDateNow

  beforeEach(() => {
    originalDateNow = Date.now
    spyOn(Date, 'now').and.returnValue(1_000_000)
  })

  afterEach(() => {
    Date.now = originalDateNow
  })

  it('should read trace data from meta tags', () => {
    const document = window.document.implementation.createHTMLDocument('trace')
    const traceIdMeta = document.createElement('meta')
    traceIdMeta.setAttribute('name', 'df-trace-id')
    traceIdMeta.content = 'trace-1'
    const traceTimeMeta = document.createElement('meta')
    traceTimeMeta.setAttribute('name', 'df-trace-time')
    traceTimeMeta.content = String(1_000_000)
    document.head.appendChild(traceIdMeta)
    document.head.appendChild(traceTimeMeta)

    expect(getDocumentTraceDataFromMeta(document)).toEqual({
      traceId: 'trace-1',
      traceTime: 1_000_000
    })
    expect(getDocumentTraceId(document)).toBe('trace-1')
  })

  it('should read trace data from special comments in the document or body tail', () => {
    const document = window.document.implementation.createHTMLDocument('trace')
    document.body.appendChild(document.createTextNode('\n'))
    document.body.appendChild(document.createComment(' GUANCE;trace-id=trace-2; trace-time=1000000 '))

    expect(findTraceComment(document)).toBe('trace-id=trace-2; trace-time=1000000')
    expect(getDocumentTraceDataFromComment(document)).toEqual({
      traceId: 'trace-2',
      traceTime: 1_000_000
    })
    expect(getDocumentTraceId(document)).toBe('trace-2')
  })

  it('should reject invalid or outdated trace data', () => {
    expect(createDocumentTraceData('trace-1', '0')).toBeUndefined()
    expect(createDocumentTraceData('', '100')).toBeUndefined()

    const document = window.document.implementation.createHTMLDocument('trace')
    const traceIdMeta = document.createElement('meta')
    traceIdMeta.setAttribute('name', 'df-trace-id')
    traceIdMeta.content = 'trace-3'
    const traceTimeMeta = document.createElement('meta')
    traceTimeMeta.setAttribute('name', 'df-trace-time')
    traceTimeMeta.content = String(1_000_000 - INITIAL_DOCUMENT_OUTDATED_TRACE_ID_THRESHOLD - 1)
    document.head.appendChild(traceIdMeta)
    document.head.appendChild(traceTimeMeta)

    expect(getDocumentTraceId(document)).toBeUndefined()
  })
})
