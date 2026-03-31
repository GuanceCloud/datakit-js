import { DefaultPrivacyLevel } from '@cloudcare/browser-core'
import {
  CENSORED_IMG_MARK,
  CENSORED_STRING_MARK,
  FORM_PRIVATE_TAG_NAMES,
  NodePrivacyLevel,
  PRIVACY_ATTR_NAME,
  PRIVACY_ATTR_VALUE_ALLOW,
  PRIVACY_ATTR_VALUE_HIDDEN,
  PRIVACY_ATTR_VALUE_MASK,
  PRIVACY_ATTR_VALUE_MASK_USER_INPUT,
  PRIVACY_CLASS_ALLOW,
  PRIVACY_CLASS_HIDDEN,
  PRIVACY_CLASS_MASK,
  PRIVACY_CLASS_MASK_USER_INPUT
} from './constants'

describe('rum constants', () => {
  it('should expose privacy levels derived from core defaults', () => {
    expect(NodePrivacyLevel).toEqual({
      IGNORE: 'ignore',
      HIDDEN: 'hidden',
      ALLOW: DefaultPrivacyLevel.ALLOW,
      MASK: DefaultPrivacyLevel.MASK,
      MASK_USER_INPUT: DefaultPrivacyLevel.MASK_USER_INPUT
    })
  })

  it('should expose privacy attribute and class names', () => {
    expect(PRIVACY_ATTR_NAME).toBe('data-gc-privacy')
    expect(PRIVACY_ATTR_VALUE_ALLOW).toBe('allow')
    expect(PRIVACY_ATTR_VALUE_MASK).toBe('mask')
    expect(PRIVACY_ATTR_VALUE_MASK_USER_INPUT).toBe('mask-user-input')
    expect(PRIVACY_ATTR_VALUE_HIDDEN).toBe('hidden')
    expect(PRIVACY_CLASS_ALLOW).toBe('gc-privacy-allow')
    expect(PRIVACY_CLASS_MASK).toBe('gc-privacy-mask')
    expect(PRIVACY_CLASS_MASK_USER_INPUT).toBe('gc-privacy-mask-user-input')
    expect(PRIVACY_CLASS_HIDDEN).toBe('gc-privacy-hidden')
  })

  it('should expose censor markers and private form tags', () => {
    expect(CENSORED_STRING_MARK).toBe('***')
    expect(CENSORED_IMG_MARK).toContain('data:image/gif;base64,')
    expect(FORM_PRIVATE_TAG_NAMES).toEqual({
      INPUT: true,
      OUTPUT: true,
      TEXTAREA: true,
      SELECT: true,
      OPTION: true,
      DATALIST: true,
      OPTGROUP: true
    })
  })
})
