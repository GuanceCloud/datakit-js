import { createErrorFieldFromRawError } from './createErrorFieldFromRawError'

describe('logs/createErrorFieldFromRawError', () => {
  it('should build an error field without the message by default', () => {
    expect(
      createErrorFieldFromRawError({
        stack: 'stack',
        type: 'TypeError',
        message: 'boom',
        causes: ['root'],
        handling: 'handled'
      })
    ).toEqual({
      stack: 'stack',
      kind: 'TypeError',
      message: undefined,
      causes: ['root'],
      handling: 'handled'
    })
  })

  it('should include the message when requested', () => {
    expect(
      createErrorFieldFromRawError(
        {
          stack: 'stack',
          type: 'Error',
          message: 'boom'
        },
        { includeMessage: true }
      )
    ).toEqual({
      stack: 'stack',
      kind: 'Error',
      message: 'boom',
      causes: undefined,
      handling: undefined
    })
  })
})
