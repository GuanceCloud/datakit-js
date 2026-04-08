describe('buildEnv', () => {
  let originalBuildEnvVersion

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'spec-sdk-version'
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should expose the sdk name and injected sdk version', () => {
    const { buildEnv } = require('./buildEnv')

    expect(buildEnv).toEqual({
      sdkVersion: 'spec-sdk-version',
      sdkName: 'df_web_rum_sdk'
    })
  })
})
