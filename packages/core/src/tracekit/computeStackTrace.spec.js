import { computeStackTrace } from './computeStackTrace'

describe('computeStackTrace', () => {
  it('should parse chrome stack frames', () => {
    const stack = computeStackTrace({
      name: 'TypeError',
      message: 'boom',
      stack:
        'TypeError: boom\n    at run (https://example.com/app.js:10:20)\n    at https://example.com/lib.js:1:2'
    })

    expect(stack.name).toBe('TypeError')
    expect(stack.message).toBe('boom')
    expect(stack.stack).toEqual([
      {
        args: [],
        column: 20,
        func: 'run',
        line: 10,
        url: 'https://example.com/app.js'
      },
      {
        args: [],
        column: 2,
        func: '?',
        line: 1,
        url: 'https://example.com/lib.js'
      }
    ])
  })

  it('should parse gecko-style stack frames', () => {
    const stack = computeStackTrace({
      name: 'ReferenceError',
      message: 'missing',
      stack: 'fn(arg1,arg2)@https://example.com/app.js:12:34'
    })

    expect(stack.stack).toEqual([
      {
        args: ['arg1', 'arg2'],
        column: 34,
        func: 'fn',
        line: 12,
        url: 'https://example.com/app.js'
      }
    ])
  })

  it('should return an empty stack when no parsable frames are present', () => {
    const stack = computeStackTrace({
      name: 'Error',
      message: 'boom',
      stack: 'not a parsable stack'
    })

    expect(stack.stack).toEqual([])
  })
})
