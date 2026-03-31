import {
  getSyntheticsResultId,
  getSyntheticsTestId,
  SYNTHETICS_INJECTS_RUM_COOKIE_NAME,
  SYNTHETICS_RESULT_ID_COOKIE_NAME,
  SYNTHETICS_TEST_ID_COOKIE_NAME,
  willSyntheticsInjectRum
} from './syntheticsWorkerValues'
import { deleteCookie, setCookie } from '../browser/cookie'

describe('syntheticsWorkerValues', () => {
  let originalInjectRum
  let originalPublicId
  let originalResultId

  beforeEach(() => {
    originalInjectRum = window._GUANCE_SYNTHETICS_INJECTS_RUM
    originalPublicId = window._GUANCE_SYNTHETICS_PUBLIC_ID
    originalResultId = window._GUANCE_SYNTHETICS_RESULT_ID
  })

  afterEach(() => {
    window._GUANCE_SYNTHETICS_INJECTS_RUM = originalInjectRum
    window._GUANCE_SYNTHETICS_PUBLIC_ID = originalPublicId
    window._GUANCE_SYNTHETICS_RESULT_ID = originalResultId
    deleteCookie(SYNTHETICS_INJECTS_RUM_COOKIE_NAME)
    deleteCookie(SYNTHETICS_TEST_ID_COOKIE_NAME)
    deleteCookie(SYNTHETICS_RESULT_ID_COOKIE_NAME)
  })

  it('should expose synthetics cookie names', () => {
    expect(SYNTHETICS_TEST_ID_COOKIE_NAME).toBe('guance-synthetics-public-id')
    expect(SYNTHETICS_RESULT_ID_COOKIE_NAME).toBe('guance-synthetics-result-id')
    expect(SYNTHETICS_INJECTS_RUM_COOKIE_NAME).toBe(
      'guance-synthetics-injects-rum'
    )
  })

  it('should read synthetics values from globals before cookies', () => {
    window._GUANCE_SYNTHETICS_INJECTS_RUM = true
    window._GUANCE_SYNTHETICS_PUBLIC_ID = 'test-id'
    window._GUANCE_SYNTHETICS_RESULT_ID = 'result-id'

    expect(willSyntheticsInjectRum()).toBeTrue()
    expect(getSyntheticsTestId()).toBe('test-id')
    expect(getSyntheticsResultId()).toBe('result-id')
  })

  it('should fall back to cookies and ignore non-string ids', () => {
    window._GUANCE_SYNTHETICS_PUBLIC_ID = 123
    window._GUANCE_SYNTHETICS_RESULT_ID = false
    setCookie(SYNTHETICS_INJECTS_RUM_COOKIE_NAME, '1', 60 * 1000)
    setCookie(SYNTHETICS_TEST_ID_COOKIE_NAME, 'cookie-test-id', 60 * 1000)
    setCookie(
      SYNTHETICS_RESULT_ID_COOKIE_NAME,
      'cookie-result-id',
      60 * 1000
    )

    expect(willSyntheticsInjectRum()).toBeTrue()
    expect(getSyntheticsTestId()).toBe('cookie-test-id')
    expect(getSyntheticsResultId()).toBe('cookie-result-id')
  })
})
