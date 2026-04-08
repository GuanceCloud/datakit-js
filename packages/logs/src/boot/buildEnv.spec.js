describe('logs buildEnv', () => {
  let originalBuildEnvVersion

  beforeEach(() => {
    originalBuildEnvVersion = globalThis.__BUILD_ENV__SDK_VERSION__
    globalThis.__BUILD_ENV__SDK_VERSION__ = 'logs-spec-version'
  })

  afterEach(() => {
    globalThis.__BUILD_ENV__SDK_VERSION__ = originalBuildEnvVersion
  })

  it('should expose the logs sdk name and injected sdk version', () => {
    const { buildEnv } = require('./buildEnv')

    expect(buildEnv).toEqual({
      sdkVersion: 'logs-spec-version',
      sdkName: 'df_web_logs_sdk'
    })
  })
})
