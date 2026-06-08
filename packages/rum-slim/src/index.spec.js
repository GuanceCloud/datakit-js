describe('rum-slim index', () => {
  let rumSlimIndex
  let originalBuildEnvVersion
  let originalDatafluxRum

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    originalDatafluxRum = globalThis.DATAFLUX_RUM
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'test-version'
    rumSlimIndex = require('./index')
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
    globalThis.DATAFLUX_RUM = originalDatafluxRum
  })

  it('should expose the slim rum api entry without session replay controls', () => {
    expect(rumSlimIndex.datafluxRum).toEqual(jasmine.any(Object))
    expect(typeof rumSlimIndex.datafluxRum.init).toBe('function')
    expect(rumSlimIndex.datafluxRum.startSessionReplayRecording).toBeUndefined()
    expect(rumSlimIndex.datafluxRum.stopSessionReplayRecording).toBeUndefined()
    expect(rumSlimIndex.datafluxRum.snapshotCanvas).toBeUndefined()
    expect(globalThis.DATAFLUX_RUM).toBe(rumSlimIndex.datafluxRum)
  })
})

