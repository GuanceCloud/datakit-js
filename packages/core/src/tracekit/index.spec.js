import * as tracekitIndex from './index'

describe('tracekit index', () => {
  it('should re-export tracekit entry points', () => {
    expect(tracekitIndex.computeStackTrace).toEqual(jasmine.any(Function))
    expect(tracekitIndex.startUnhandledErrorCollection).toEqual(
      jasmine.any(Function)
    )
  })
})
