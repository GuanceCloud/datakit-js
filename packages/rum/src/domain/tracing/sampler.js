import { performDraw } from '@cloudcare/browser-core'

let sampleDecisionCache

export function isTraceSampled(sessionId, sampleRate) {
  // Shortcuts for common cases. This is not strictly necessary, but it makes the code faster for
  // customers willing to ingest all traces.
  if (sampleRate === 100) {
    return true
  }

  if (sampleRate === 0) {
    return false
  }

  if (sampleDecisionCache && sessionId === sampleDecisionCache.sessionId) {
    return sampleDecisionCache.decision
  }

  let decision
  // @ts-expect-error BigInt might not be defined in every browser we support
  if (window.BigInt) {
    decision = sampleUsingKnuthFactor(
      BigInt(`0x${sessionId.split('-')[4]}`),
      sampleRate
    )
  } else {
    // For simplicity, we don't use consistent sampling for browser without BigInt support
    // TODO: remove this when all browser we support have BigInt support
    decision = performDraw(sampleRate)
  }
  sampleDecisionCache = { sessionId, decision }
  return decision
}

// Exported for tests
export function resetSampleDecisionCache() {
  sampleDecisionCache = undefined
}

/**
 * Perform sampling using the Knuth factor method. This method offer consistent sampling result
 * based on the provided identifier.
 *
 * @param identifier The identifier to use for sampling.
 * @param sampleRate The sample rate in percentage between 0 and 100.
 */
export function sampleUsingKnuthFactor(identifier, sampleRate) {
  // The formula is:
  //
  //   (identifier * knuthFactor) % 2^64 < sampleRate * 2^64
  //
  // Because JavaScript numbers are 64-bit floats, we can't represent 64-bit integers, and the
  // modulo would be incorrect. Thus, we are using BigInts here.

  // Note: All implementations have slight variations. Some of them use '<=' instead of '<', and
  // use `sampleRate * 2^64 - 1` instead of `sampleRate * 2^64`. The following implementation
  // should adhere to the spec and is a bit simpler than using a 2^64-1 limit as there are less
  // BigInt arithmetic to write. In practice this does not matter, as we are using floating point
  // numbers in the end, and Number(2n**64n-1n) === Number(2n**64n).
  const knuthFactor = BigInt('1111111111111111111')
  const twoPow64 = BigInt('0x10000000000000000') // 2n ** 64n
  const hash = (identifier * knuthFactor) % twoPow64
  return Number(hash) <= (sampleRate / 100) * Number(twoPow64)
}
