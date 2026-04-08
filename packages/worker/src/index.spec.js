describe('worker/index', () => {
  let originalSelf

  beforeEach(() => {
    originalSelf = globalThis.self
  })

  afterEach(() => {
    globalThis.self = originalSelf
  })

  it('should start the worker immediately on module evaluation', () => {
    const fakeSelf = {
      addEventListener: jasmine.createSpy('addEventListener'),
      postMessage: jasmine.createSpy('postMessage')
    }

    globalThis.self = fakeSelf

    require('./index')

    expect(fakeSelf.addEventListener).toHaveBeenCalledWith(
      'message',
      jasmine.any(Function)
    )
  })
})
