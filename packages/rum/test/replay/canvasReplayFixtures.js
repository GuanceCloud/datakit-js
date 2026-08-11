import { IncrementalSource, RecordType } from '../../src/types'
import {
  buildSerializedCanvasImage,
  estimateEncodedBytesFromDataUrl
} from '../../src/domain/replay/record/canvasSerializeArgs'

export var CANVAS_REPLAY_SAMPLE_DATA_URLS = {
  manual: 'data:image/webp;base64,QUJD',
  frame: 'data:image/webp;base64,REVG',
  cleared:
    'data:image/webp;base64,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
}

export function createCanvasMutationFixture(options) {
  var timestamp = options.timestamp
  var id = options.id === undefined ? 1 : options.id
  var dataUrl = options.dataUrl
  var width = options.width === undefined ? 480 : options.width
  var height = options.height === undefined ? 220 : options.height
  var mimeType = options.mimeType || 'image/webp'

  return {
    type: RecordType.IncrementalSnapshot,
    timestamp: timestamp,
    data: {
      source: IncrementalSource.CanvasMutation,
      id: id,
      type: '2D',
      commands: [
        {
          property: 'clearRect',
          args: [0, 0, width, height]
        },
        {
          property: 'drawImage',
          args: [
            buildSerializedCanvasImage(dataUrl, mimeType),
            0,
            0,
            width,
            height
          ]
        }
      ],
      encodedBytesCount: estimateEncodedBytesFromDataUrl(dataUrl)
    }
  }
}

export function createCanvasReplayFixtureTimeline() {
  return [
    createCanvasMutationFixture({
      timestamp: 100,
      id: 26,
      dataUrl: CANVAS_REPLAY_SAMPLE_DATA_URLS.manual
    }),
    {
      type: RecordType.IncrementalSnapshot,
      timestamp: 150,
      data: {
        source: IncrementalSource.Scroll,
        id: 193,
        x: 0,
        y: 10
      }
    },
    createCanvasMutationFixture({
      timestamp: 200,
      id: 26,
      dataUrl: CANVAS_REPLAY_SAMPLE_DATA_URLS.frame
    }),
    {
      type: RecordType.IncrementalSnapshot,
      timestamp: 250,
      data: {
        source: IncrementalSource.MouseInteraction,
        id: 33,
        type: 0,
        x: 177,
        y: 410
      }
    },
    createCanvasMutationFixture({
      timestamp: 300,
      id: 26,
      dataUrl: CANVAS_REPLAY_SAMPLE_DATA_URLS.cleared
    })
  ]
}

export function createCanvasReplayFixturePayload() {
  var records = createCanvasReplayFixtureTimeline()
  return {
    records: records,
    start: records[0].timestamp,
    end: records[records.length - 1].timestamp,
    creation_reason: 'canvas_snapshot',
    records_count: records.length,
    has_full_snapshot: false,
    index_in_view: 1,
    source: 'browser',
    sdk: {
      name: 'df_web_rum_sdk',
      version: 'fixture'
    },
    env: 'test',
    service: 'browser',
    version: '1.0.0',
    app: {
      id: 'canvas_replay_fixture'
    },
    session: {
      id: 'canvas-replay-fixture-session'
    },
    view: {
      id: 'canvas-replay-fixture-view'
    }
  }
}
