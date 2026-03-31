import { buildReplayPayload, toFormEntries } from './buildReplayPayload'

describe('buildReplayPayload', () => {
  it('should flatten nested metadata into form entries', () => {
    const entries = []

    toFormEntries(
      {
        session: {
          id: 'session-1'
        },
        hasReplay: true,
        count: 2
      },
      (key, value) => {
        entries.push([key, value])
      }
    )

    expect(entries).toEqual([
      ['session_id', 'session-1'],
      ['hasReplay', 'true'],
      ['count', '2']
    ])
  })

  it('should build replay payload form data and byte count', () => {
    const data = new Uint8Array([1, 2, 3, 4])
    const metadata = {
      session: { id: 'session-1' },
      start: 123,
      view: { id: 'view-1' }
    }

    const payload = buildReplayPayload(data, metadata, 42)

    expect(payload.bytesCount).toBe(4)
    expect(payload.data.get('start')).toBe('123')
    expect(payload.data.get('session_id')).toBe('session-1')
    expect(payload.data.get('view_id')).toBe('view-1')
    expect(payload.data.get('raw_segment_size')).toBe('42')

    const segment = payload.data.get('segment')
    expect(segment).toEqual(jasmine.any(Blob))
    expect(segment.name).toBe('session-1-123')
  })
})
