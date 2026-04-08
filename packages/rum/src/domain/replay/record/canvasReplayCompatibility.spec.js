import { IncrementalSource, RecordType } from '../../../types'
import {
  CANVAS_REPLAY_SAMPLE_DATA_URLS,
  createCanvasMutationFixture,
  createCanvasReplayFixtureTimeline
} from './canvasReplayFixtures'

function getBase64FromSerializedImage(serialisedImage) {
  return serialisedImage.args[0].data[0].base64
}

function applyCanvasMutationToPlayerState(state, event) {
  if (
    event.type !== RecordType.IncrementalSnapshot ||
    event.data.source !== IncrementalSource.CanvasMutation
  ) {
    return state
  }
  return {
    timestamp: event.timestamp,
    canvasId: event.data.id,
    width: event.data.commands[0].args[2],
    height: event.data.commands[0].args[3],
    imageBase64: getBase64FromSerializedImage(event.data.commands[1].args[0])
  }
}

function seekCanvasState(events, targetTimestamp) {
  return events
    .filter(function (event) {
      return event.timestamp <= targetTimestamp
    })
    .reduce(function (state, event) {
      return applyCanvasMutationToPlayerState(state, event)
    }, undefined)
}

describe('replay/record/canvasReplayCompatibility', () => {
  var firstFrame
  var secondFrame

  beforeEach(() => {
    firstFrame = createCanvasMutationFixture({
      timestamp: 100,
      dataUrl: CANVAS_REPLAY_SAMPLE_DATA_URLS.manual
    })
    secondFrame = createCanvasMutationFixture({
      timestamp: 200,
      dataUrl: CANVAS_REPLAY_SAMPLE_DATA_URLS.frame
    })
  })

  it('should keep the last applied canvas frame while playback is paused', () => {
    var pausedState = applyCanvasMutationToPlayerState(undefined, firstFrame)

    expect(pausedState).toEqual({
      timestamp: 100,
      canvasId: 1,
      width: 480,
      height: 220,
      imageBase64: 'QUJD'
    })
  })

  it('should restore the closest previous canvas frame when seeking', () => {
    var stateBeforeSecondFrame = seekCanvasState(
      [firstFrame, secondFrame],
      150
    )
    var stateAfterSecondFrame = seekCanvasState([firstFrame, secondFrame], 250)

    expect(stateBeforeSecondFrame.imageBase64).toBe('QUJD')
    expect(stateAfterSecondFrame.imageBase64).toBe('REVG')
  })

  it('should ignore non-canvas replay events during seek reconstruction', () => {
    var state = seekCanvasState(createCanvasReplayFixtureTimeline(), 250)

    expect(state.imageBase64).toBe('REVG')
    expect(state.canvasId).toBe(26)
  })

  it('should restore the cleared fixture after seeking past the final canvas frame', () => {
    var state = seekCanvasState(createCanvasReplayFixtureTimeline(), 350)

    expect(state.imageBase64).toBe(
      'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA='
    )
    expect(state.canvasId).toBe(26)
  })
})
