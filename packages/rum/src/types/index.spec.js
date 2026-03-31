import * as rumTypes from './index'

describe('rum types index', () => {
  it('should re-export session replay constants', () => {
    expect(rumTypes.RecordType).toEqual(jasmine.any(Object))
    expect(rumTypes.NodeType).toEqual(jasmine.any(Object))
    expect(rumTypes.IncrementalSource).toEqual(jasmine.any(Object))
    expect(rumTypes.MouseInteractionType).toEqual(jasmine.any(Object))
    expect(rumTypes.MediaInteractionType).toEqual(jasmine.any(Object))
  })
})
