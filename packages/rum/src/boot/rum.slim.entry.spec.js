describe('rum.slim.entry', () => {
  let originalBuildEnvVersion
  let originalDatafluxRum

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    originalDatafluxRum = globalThis.DATAFLUX_RUM
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'spec-sdk-version'
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
    globalThis.DATAFLUX_RUM = originalDatafluxRum
  })

  it('should export the slim public api and define it on the global object', () => {
    const rumSlimEntry = require('./rum.slim.entry')

    expect(rumSlimEntry.datafluxRum).toEqual(jasmine.any(Object))
    expect(rumSlimEntry.datafluxRum.init).toEqual(jasmine.any(Function))
    expect(rumSlimEntry.datafluxRum.startSession).toEqual(jasmine.any(Function))
    expect(rumSlimEntry.datafluxRum.startView).toEqual(jasmine.any(Function))
    expect(rumSlimEntry.datafluxRum.startSessionReplayRecording).toBeUndefined()
    expect(globalThis.DATAFLUX_RUM).toBe(rumSlimEntry.datafluxRum)
  })
})
