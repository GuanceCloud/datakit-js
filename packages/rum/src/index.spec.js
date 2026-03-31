describe('rum index', () => {
  let rumIndex
  let originalBuildEnvVersion

  beforeAll(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'test-version'
    rumIndex = require('./index')
  })

  afterAll(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should expose the public rum api entry', () => {
    expect(rumIndex.datafluxRum).toEqual(jasmine.any(Object))
    expect(typeof rumIndex.datafluxRum.init).toBe('function')
  })
})
