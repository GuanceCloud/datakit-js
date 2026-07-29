describe('recorderApiStub', () => {
  it('should expose no-op recording behavior', async () => {
    const { makeRecorderApiStub } = require('./recorderApiStub')

    const recorderApi = makeRecorderApiStub()

    expect(recorderApi.isRecording()).toBeFalse()
    expect(recorderApi.getReplayStats()).toBeUndefined()
    const snapshotPromise = recorderApi.snapshotCanvas()
    expect(snapshotPromise).toEqual(jasmine.any(Promise))
    expect(await snapshotPromise).toEqual({
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
