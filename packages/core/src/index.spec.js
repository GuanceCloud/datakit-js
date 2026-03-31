import * as coreIndex from './index'

describe('core index', () => {
  it('should expose key public entry points', () => {
    expect(coreIndex.createHttpRequest).toEqual(jasmine.any(Function))
    expect(coreIndex.startSessionManager).toEqual(jasmine.any(Function))
    expect(coreIndex.stopSessionManager).toEqual(jasmine.any(Function))
    expect(coreIndex.computeStackTrace).toEqual(jasmine.any(Function))
    expect(coreIndex.createFlushController).toEqual(jasmine.any(Function))
    expect(coreIndex.getEventBridge).toEqual(jasmine.any(Function))
    expect(coreIndex.createBoundedBuffer).toEqual(jasmine.any(Function))
    expect(coreIndex.Observable).toEqual(jasmine.any(Function))
    expect(coreIndex.CustomerDataType).toEqual(jasmine.any(Object))
    expect(coreIndex.SessionPersistence).toEqual(jasmine.any(Object))
  })
})
