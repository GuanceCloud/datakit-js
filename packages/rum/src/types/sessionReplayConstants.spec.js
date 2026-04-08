import {
  IncrementalSource,
  MediaInteractionType,
  MouseInteractionType,
  NodeType,
  RecordType
} from './sessionReplayConstants'

describe('sessionReplayConstants', () => {
  it('should expose replay record and node type enums', () => {
    expect(RecordType).toEqual({
      FullSnapshot: 2,
      IncrementalSnapshot: 3,
      Meta: 4,
      Focus: 6,
      ViewEnd: 7,
      VisualViewport: 8,
      FrustrationRecord: 9
    })
    expect(NodeType).toEqual({
      Document: 0,
      DocumentType: 1,
      Element: 2,
      Text: 3,
      CDATA: 4,
      DocumentFragment: 11
    })
  })

  it('should expose incremental and interaction source enums', () => {
    expect(IncrementalSource).toEqual({
      Mutation: 0,
      MouseMove: 1,
      MouseInteraction: 2,
      Scroll: 3,
      ViewportResize: 4,
      Input: 5,
      TouchMove: 6,
      MediaInteraction: 7,
      StyleSheetRule: 8,
      CanvasMutation: 9
    })
    expect(MouseInteractionType.Click).toBe(2)
    expect(MouseInteractionType.TouchEnd).toBe(9)
    expect(MediaInteractionType).toEqual({
      Play: 0,
      Pause: 1
    })
  })
})
