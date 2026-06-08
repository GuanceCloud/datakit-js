describe('recorderApiStub', () => {
  it('should expose no-op recording behavior', () => {
    const { makeRecorderApiStub } = require('./recorderApiStub')

    const recorderApi = makeRecorderApiStub()

    expect(recorderApi.isRecording()).toBeFalse()
    expect(recorderApi.getReplayStats()).toBeUndefined()
    expect(recorderApi.snapshotCanvas()).toEqual({
      ok: false,
      reason: 'not_recording'
    })
    expect(recorderApi.getReplayPerformanceForDebug()).toBeUndefined()
  })

  it('should expose the minimal rum recorder stub', () => {
    const { makeRumRecorderApiStub } = require('./rumRecorderApiStub')

    const recorderApi = makeRumRecorderApiStub()

    expect(recorderApi.isRecording()).toBeFalse()
    expect(recorderApi.getReplayStats()).toBeUndefined()
    expect(recorderApi.snapshotCanvas).toBeUndefined()
  })
})
