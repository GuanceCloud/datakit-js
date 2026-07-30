describe('rum.entry', () => {
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

  it('should export the public api and define it on the global object', () => {
    const rumEntry = require('./rum.entry')

    expect(rumEntry.datafluxRum).toEqual(jasmine.any(Object))
    expect(rumEntry.datafluxRum.init).toEqual(jasmine.any(Function))
    expect(rumEntry.datafluxRum.startSession).toEqual(jasmine.any(Function))
    expect(rumEntry.datafluxRum.startSessionReplayRecording).toEqual(
      jasmine.any(Function)
    )
    expect(rumEntry.datafluxRum.startView).toEqual(jasmine.any(Function))
    expect(globalThis.DATAFLUX_RUM).toBe(rumEntry.datafluxRum)
  })
})
