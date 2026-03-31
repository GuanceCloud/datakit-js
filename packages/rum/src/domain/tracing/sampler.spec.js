import { isTraceSampled, resetSampleDecisionCache, sampleUsingKnuthFactor } from './sampler'

describe('sampler', () => {
  let originalBigInt

  beforeEach(() => {
    originalBigInt = window.BigInt
    resetSampleDecisionCache()
  })

  afterEach(() => {
    window.BigInt = originalBigInt
    resetSampleDecisionCache()
  })

  it('should shortcut common sample rates', () => {
    expect(isTraceSampled('00000000-0000-0000-0000-000000000000', 100)).toBeTrue()
    expect(isTraceSampled('00000000-0000-0000-0000-000000000000', 0)).toBeFalse()
  })

  it('should cache the sampling decision for a given session id', () => {
    const sessionId = '00000000-0000-0000-0000-000000000001'

    const firstDecision = isTraceSampled(sessionId, 50)
    const secondDecision = isTraceSampled(sessionId, 50)

    expect(secondDecision).toBe(firstDecision)
  })

  it('should fallback to non-consistent sampling when BigInt is unavailable', () => {
    window.BigInt = undefined
    spyOn(Math, 'random').and.returnValue(0.1)

    expect(
      isTraceSampled('00000000-0000-0000-0000-000000000001', 50)
    ).toBeTrue()
  })

  it('should sample consistently using the Knuth factor helper', () => {
    expect(sampleUsingKnuthFactor(BigInt(1), 0)).toBeFalse()
    expect(sampleUsingKnuthFactor(BigInt(1), 100)).toBeTrue()
    expect(sampleUsingKnuthFactor(BigInt(123456789), 50)).toEqual(
      sampleUsingKnuthFactor(BigInt(123456789), 50)
    )
  })
})
