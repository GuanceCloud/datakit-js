import {
  BridgeCapability,
  bridgeSupports,
  canUseEventBridge,
  createBatch,
  createFlushController,
  createHttpRequest,
  getEventBridge,
  processedMessageByDataMap,
  startBatchWithReplica
} from './index'

describe('transport index', () => {
  it('should re-export transport entry points', () => {
    expect(createHttpRequest).toEqual(jasmine.any(Function))
    expect(createBatch).toEqual(jasmine.any(Function))
    expect(processedMessageByDataMap).toEqual(jasmine.any(Function))
    expect(startBatchWithReplica).toEqual(jasmine.any(Function))
    expect(createFlushController).toEqual(jasmine.any(Function))
    expect(getEventBridge).toEqual(jasmine.any(Function))
    expect(canUseEventBridge).toEqual(jasmine.any(Function))
    expect(bridgeSupports).toEqual(jasmine.any(Function))
    expect(BridgeCapability).toEqual(jasmine.any(Object))
  })
})
