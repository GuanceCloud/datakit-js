describe('rumSlimConfiguration', () => {
  it('should force session replay and intake compression off', () => {
    const { forceRumSlimConfiguration } = require('./rumSlimConfiguration')
    const initConfiguration = {
      applicationId: 'app-1',
      datakitUrl: 'https://datakit.example.com',
      sessionReplaySampleRate: 100,
      sessionReplayOnErrorSampleRate: 100,
      replayCanvasEnabled: true,
      compressIntakeRequests: true
    }

    const slimConfiguration = forceRumSlimConfiguration(initConfiguration)

    expect(slimConfiguration).toEqual(
      jasmine.objectContaining({
        sessionReplaySampleRate: 0,
        sessionReplayOnErrorSampleRate: 0,
        replayCanvasEnabled: false,
        compressIntakeRequests: false
      })
    )
    expect(initConfiguration.compressIntakeRequests).toBeTrue()
  })
})

