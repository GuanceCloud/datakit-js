import {
  computeRawError,
  ErrorSource,
  flattenErrorCauses,
  formatErrorMessage,
  formatUnknownError,
  getFileFromStackTraceString,
  NO_ERROR_STACK_PRESENT_MESSAGE,
  toStackTraceString
} from './errorTools'

describe('errorTools', () => {
  it('should compute raw errors from Error instances', () => {
    const error = new Error('boom')

    const rawError = computeRawError({
      originalError: error,
      startClocks: { relative: 1, timeStamp: 2 },
      nonErrorPrefix: 'Uncaught',
      source: ErrorSource.SOURCE,
      handling: 'unhandled'
    })

    expect(rawError).toEqual(
      jasmine.objectContaining({
        source: ErrorSource.SOURCE,
        handling: 'unhandled',
        originalError: error,
        message: 'boom',
        type: 'Error'
      })
    )
    expect(rawError.stack).toContain('Error: boom')
  })

  it('should compute raw errors from non Error values', () => {
    const rawError = computeRawError({
      originalError: { foo: 'bar' },
      startClocks: { relative: 1, timeStamp: 2 },
      nonErrorPrefix: 'Uncaught',
      source: ErrorSource.CUSTOM,
      handling: 'handled'
    })

    expect(rawError).toEqual(
      jasmine.objectContaining({
        source: ErrorSource.CUSTOM,
        handling: 'handled',
        message: 'Uncaught {"foo":"bar"}',
        stack: NO_ERROR_STACK_PRESENT_MESSAGE
      })
    )
  })

  it('should format stack traces and extract the file path', () => {
    const stackTrace = {
      name: 'TypeError',
      message: 'oops',
      stack: [
        {
          func: 'run',
          url: 'https://example.com/app.js',
          line: 10,
          column: 20
        }
      ]
    }

    const stack = toStackTraceString(stackTrace)

    expect(formatErrorMessage(stackTrace)).toBe('TypeError: oops')
    expect(stack).toContain('at run @ https://example.com/app.js:10:20')
    expect(getFileFromStackTraceString(stack)).toBe(
      'https://example.com/app.js:10:20'
    )
  })

  it('should format unknown errors with and without stack traces', () => {
    const stackTrace = {
      name: 'ReferenceError',
      message: 'missing',
      stack: [
        {
          func: '?',
          url: 'https://example.com/app.js',
          line: 1,
          column: 2
        }
      ]
    }

    expect(
      formatUnknownError(stackTrace, new Error('missing'), 'Uncaught ', 'stack')
    ).toEqual(
      jasmine.objectContaining({
        message: 'missing',
        type: 'ReferenceError'
      })
    )

    expect(
      formatUnknownError(undefined, { foo: 'bar' }, 'Uncaught ', 'stack')
    ).toEqual({
      message: 'Uncaught {"foo":"bar"}',
      stack: NO_ERROR_STACK_PRESENT_MESSAGE,
      handlingStack: 'stack',
      type: undefined
    })
  })

  it('should flatten nested error causes', () => {
    const deepest = new Error('deepest')
    const middle = new Error('middle')
    middle.cause = deepest
    const top = new Error('top')
    top.cause = middle

    const causes = flattenErrorCauses(top, ErrorSource.SOURCE)

    expect(causes.length).toBe(2)
    expect(causes[0]).toEqual(
      jasmine.objectContaining({
        message: 'middle',
        source: ErrorSource.SOURCE
      })
    )
    expect(causes[1]).toEqual(
      jasmine.objectContaining({
        message: 'deepest',
        source: ErrorSource.SOURCE
      })
    )
  })
})
