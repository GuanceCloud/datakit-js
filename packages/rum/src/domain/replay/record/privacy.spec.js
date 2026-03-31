import {
  CENSORED_STRING_MARK,
  NodePrivacyLevel,
  PRIVACY_ATTR_NAME,
  PRIVACY_ATTR_VALUE_ALLOW,
  PRIVACY_ATTR_VALUE_HIDDEN,
  PRIVACY_ATTR_VALUE_MASK,
  PRIVACY_ATTR_VALUE_MASK_USER_INPUT
} from '../../../constants'
import {
  censorText,
  getNodePrivacyLevel,
  getNodeSelfPrivacyLevel,
  getTextContent,
  reducePrivacyLevel,
  shouldMaskNode
} from './privacy'

describe('replay/record/privacy', () => {
  it('should resolve self privacy level from input types, attributes, and classes', () => {
    const passwordInput = document.createElement('input')
    passwordInput.type = 'password'
    expect(getNodeSelfPrivacyLevel(passwordInput)).toBe(NodePrivacyLevel.MASK)

    const hiddenDiv = document.createElement('div')
    hiddenDiv.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_HIDDEN)
    expect(getNodeSelfPrivacyLevel(hiddenDiv)).toBe(NodePrivacyLevel.HIDDEN)

    const allowDiv = document.createElement('div')
    allowDiv.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_ALLOW)
    expect(getNodeSelfPrivacyLevel(allowDiv)).toBe(NodePrivacyLevel.ALLOW)

    const maskUserInputDiv = document.createElement('div')
    maskUserInputDiv.setAttribute(
      PRIVACY_ATTR_NAME,
      PRIVACY_ATTR_VALUE_MASK_USER_INPUT
    )
    expect(getNodeSelfPrivacyLevel(maskUserInputDiv)).toBe(
      NodePrivacyLevel.MASK_USER_INPUT
    )

    const maskDiv = document.createElement('div')
    maskDiv.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_MASK)
    expect(getNodeSelfPrivacyLevel(maskDiv)).toBe(NodePrivacyLevel.MASK)
  })

  it('should compute inherited privacy levels and cache them', () => {
    const cache = new WeakMap()
    const parent = document.createElement('div')
    parent.setAttribute(PRIVACY_ATTR_NAME, PRIVACY_ATTR_VALUE_MASK)
    const child = document.createElement('span')
    parent.appendChild(child)

    expect(getNodePrivacyLevel(child, NodePrivacyLevel.ALLOW, cache)).toBe(
      NodePrivacyLevel.MASK
    )
    expect(cache.get(child)).toBe(NodePrivacyLevel.MASK)
  })

  it('should reduce privacy levels with hidden/ignore precedence', () => {
    expect(
      reducePrivacyLevel(NodePrivacyLevel.ALLOW, NodePrivacyLevel.HIDDEN)
    ).toBe(NodePrivacyLevel.HIDDEN)
    expect(
      reducePrivacyLevel(NodePrivacyLevel.MASK, NodePrivacyLevel.ALLOW)
    ).toBe(NodePrivacyLevel.MASK)
    expect(
      reducePrivacyLevel(undefined, NodePrivacyLevel.MASK_USER_INPUT)
    ).toBe(NodePrivacyLevel.MASK_USER_INPUT)
  })

  it('should decide whether nodes should be masked', () => {
    const input = document.createElement('input')
    input.type = 'text'
    const textNode = document.createTextNode('secret')
    input.appendChild(textNode)

    expect(shouldMaskNode({}, input, NodePrivacyLevel.MASK)).toBeTrue()
    expect(
      shouldMaskNode({}, textNode, NodePrivacyLevel.MASK_USER_INPUT)
    ).toBeTrue()
    expect(
      shouldMaskNode(
        {
          shouldMaskNode: () => true
        },
        input,
        NodePrivacyLevel.ALLOW
      )
    ).toBeTrue()
  })

  it('should censor and normalize text content according to privacy rules', () => {
    expect(censorText('ab c')).toBe('xx x')

    const option = document.createElement('option')
    const optionText = document.createTextNode('visible')
    option.appendChild(optionText)
    expect(
      getTextContent({}, optionText, false, NodePrivacyLevel.MASK)
    ).toBe(CENSORED_STRING_MARK)

    const script = document.createElement('script')
    const scriptText = document.createTextNode('alert(1)')
    script.appendChild(scriptText)
    expect(
      getTextContent({}, scriptText, false, NodePrivacyLevel.ALLOW)
    ).toBe(CENSORED_STRING_MARK)

    const span = document.createElement('span')
    const whiteSpaceText = document.createTextNode('   ')
    span.appendChild(whiteSpaceText)
    expect(getTextContent({}, whiteSpaceText, true, NodePrivacyLevel.ALLOW)).toBeUndefined()
  })
})
