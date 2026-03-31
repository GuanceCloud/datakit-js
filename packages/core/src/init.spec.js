import { defineGlobal, getGlobalObject, makePublicApi } from './init'

describe('init helpers', () => {
  it('should create a public api with an onReady method and hidden debug setter', () => {
    const customMethod = jasmine.createSpy('customMethod')
    const api = makePublicApi({ customMethod })
    const readyCallback = jasmine.createSpy('readyCallback')

    api.onReady(readyCallback)

    expect(readyCallback).toHaveBeenCalled()
    expect(api.customMethod).toBe(customMethod)
    expect(typeof api._setDebug).toBe('function')
    expect(Object.keys(api)).not.toContain('_setDebug')
  })

  it('should define the global api and flush queued onReady callbacks', () => {
    const queuedCallback = jasmine.createSpy('queuedCallback')
    const globalObject = {
      SDK: {
        q: [queuedCallback]
      }
    }
    const api = makePublicApi({})

    defineGlobal(globalObject, 'SDK', api)

    expect(globalObject.SDK).toBe(api)
    expect(queuedCallback).toHaveBeenCalled()
  })

  it('should return the current global object', () => {
    expect(getGlobalObject()).toBe(globalThis)
  })
})
