import * as deflate from './index'

describe('domain/deflate/index', () => {
  it('should expose the deflate encoder and worker helpers', () => {
    expect(deflate.createDeflateEncoder).toEqual(jasmine.any(Function))
    expect(deflate.startDeflateWorker).toEqual(jasmine.any(Function))
    expect(deflate.getDeflateWorkerStatus).toEqual(jasmine.any(Function))
    expect(deflate.resetDeflateWorkerState).toEqual(jasmine.any(Function))
    expect(deflate.DeflateEncoderStreamId).toBeDefined()
    expect(deflate.DeflateWorkerStatus).toBeDefined()
  })
})
