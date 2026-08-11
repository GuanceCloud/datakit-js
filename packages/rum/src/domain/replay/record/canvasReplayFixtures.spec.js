import { IncrementalSource, RecordType } from '../../../types'
import {
  CANVAS_REPLAY_SAMPLE_DATA_URLS,
  createCanvasMutationFixture,
  createCanvasReplayFixturePayload,
  createCanvasReplayFixtureTimeline
} from '../../../../test/replay/canvasReplayFixtures'

describe('replay/record/canvasReplayFixtures', () => {
  it('should build rrweb-compatible canvas mutation fixtures', () => {
    var fixture = createCanvasMutationFixture({
      timestamp: 123,
      id: 42,
      dataUrl: CANVAS_REPLAY_SAMPLE_DATA_URLS.manual,
      width: 20,
      height: 10
    })

    expect(fixture).toEqual({
      type: RecordType.IncrementalSnapshot,
      timestamp: 123,
      data: {
        source: IncrementalSource.CanvasMutation,
        id: 42,
        type: '2D',
        commands: [
          {
            property: 'clearRect',
            args: [0, 0, 20, 10]
          },
          {
            property: 'drawImage',
            args: [
              {
                rr_type: 'ImageBitmap',
                args: [
                  {
                    rr_type: 'Blob',
                    data: [
                      {
                        rr_type: 'ArrayBuffer',
                        base64: 'QUJD'
                      }
                    ],
                    type: 'image/webp'
                  }
                ]
              },
              0,
              0,
              20,
              10
            ]
          }
        ],
        encodedBytesCount: 3
      }
    })
  })

  it('should provide a seek-friendly shared replay timeline fixture', () => {
    var timeline = createCanvasReplayFixtureTimeline()
    var canvasEvents = timeline.filter(function (event) {
      return event.data.source === IncrementalSource.CanvasMutation
    })

    expect(timeline.length).toBe(5)
    expect(canvasEvents.length).toBe(3)
    expect(timeline.map(function (event) {
      return event.timestamp
    })).toEqual([100, 150, 200, 250, 300])
    expect(canvasEvents.map(function (event) {
      return event.data.id
    })).toEqual([26, 26, 26])
    expect(timeline[1].data.source).toBe(IncrementalSource.Scroll)
    expect(timeline[3].data.source).toBe(
      IncrementalSource.MouseInteraction
    )
  })

  it('should provide a payload fixture that can be handed to a player project', () => {
    var payload = createCanvasReplayFixturePayload()

    expect(payload.records_count).toBe(5)
    expect(payload.creation_reason).toBe('canvas_snapshot')
    expect(payload.start).toBe(100)
    expect(payload.end).toBe(300)
    expect(payload.records[0].data.source).toBe(
      IncrementalSource.CanvasMutation
    )
    expect(payload.records[4].data.source).toBe(
      IncrementalSource.CanvasMutation
    )
    expect(payload.session.id).toBe('canvas-replay-fixture-session')
    expect(payload.view.id).toBe('canvas-replay-fixture-view')
  })
})
