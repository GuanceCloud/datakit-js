import * as replayRecord from './index'

describe('replay/record/index', () => {
  it('should expose the replay record entrypoints', () => {
    expect(replayRecord.record).toEqual(jasmine.any(Function))
    expect(replayRecord.serializeNodeWithId).toEqual(jasmine.any(Function))
    expect(replayRecord.serializeDocument).toEqual(jasmine.any(Function))
    expect(replayRecord.createElementsScrollPositions).toEqual(jasmine.any(Function))
    expect(replayRecord.SerializationContextStatus).toBeDefined()
  })
})
