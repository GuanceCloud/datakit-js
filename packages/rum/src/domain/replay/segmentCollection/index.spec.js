import * as segmentCollection from './index'

describe('replay/segmentCollection/index', () => {
  it('should expose the segment collection entrypoints', () => {
    expect(segmentCollection.startSegmentCollection).toEqual(jasmine.any(Function))
    expect(segmentCollection.setSegmentBytesLimit).toEqual(jasmine.any(Function))
    expect(segmentCollection.SEGMENT_BYTES_LIMIT).toBeDefined()
  })
})
