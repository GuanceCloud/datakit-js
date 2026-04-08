import {
  computeFetchErrorText,
  computeFetchResponseText,
  computeXhrResponseData
} from './networkErrorCollection'

describe('logs/networkErrorCollection', () => {
  it('should truncate xhr string responses according to the configured limit', () => {
    const callback = jasmine.createSpy('callback')

    computeXhrResponseData(
      {
        response: 'abcdefgh'
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith('abcde...')
  })

  it('should pass through non-string xhr responses unchanged', () => {
    const response = { ok: true }
    const callback = jasmine.createSpy('callback')

    computeXhrResponseData(
      {
        response
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith(response)
  })

  it('should fall back when a fetch response cannot be cloned or has no body', () => {
    const callback = jasmine.createSpy('callback')

    computeFetchResponseText(
      {
        clone() {
          throw new Error('used')
        }
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith()

    callback.calls.reset()

    computeFetchResponseText(
      {
        clone() {
          return { body: null }
        }
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      callback
    )

    expect(callback).toHaveBeenCalledWith()
  })

  it('should read fetch text responses when TextDecoder is unavailable', (done) => {
    const originalTextDecoder = window.TextDecoder

    window.TextDecoder = undefined

    computeFetchResponseText(
      {
        clone() {
          return {
            body: {},
            text() {
              return Promise.resolve('abcdefgh')
            }
          }
        }
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      (responseText) => {
        expect(responseText).toBe('abcde...')
        window.TextDecoder = originalTextDecoder
        done()
      }
    )
  })

  it('should report fetch text read failures when TextDecoder is unavailable', (done) => {
    const originalTextDecoder = window.TextDecoder

    window.TextDecoder = undefined

    computeFetchResponseText(
      {
        clone() {
          return {
            body: {},
            text() {
              return Promise.reject('denied')
            }
          }
        }
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      (responseText) => {
        expect(responseText).toBe('Unable to retrieve response: denied')
        window.TextDecoder = originalTextDecoder
        done()
      }
    )
  })

  it('should serialize fetch error stacks and apply truncation', () => {
    const callback = jasmine.createSpy('callback')

    computeFetchErrorText(
      new Error('boom'),
      {
        requestErrorResponseLengthLimit: 12
      },
      callback
    )

    expect(callback.calls.mostRecent().args[0]).toContain('Error: boom')
    expect(callback.calls.mostRecent().args[0].endsWith('...')).toBeTrue()
  })

  it('should read response bytes through TextDecoder when available', (done) => {
    computeFetchResponseText(
      {
        clone() {
          return {
            body: {
              getReader() {
                let readCount = 0
                return {
                  read() {
                    readCount += 1
                    if (readCount === 1) {
                      return Promise.resolve({
                        done: false,
                        value: new Uint8Array([97, 98, 99])
                      })
                    }
                    return Promise.resolve({ done: true })
                  },
                  cancel() {
                    return Promise.resolve()
                  }
                }
              }
            }
          }
        }
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      (responseText) => {
        expect(responseText).toBe('abc')
        done()
      }
    )
  })

  it('should report stream read failures when TextDecoder is available', (done) => {
    computeFetchResponseText(
      {
        clone() {
          return {
            body: {
              getReader() {
                return {
                  read() {
                    return Promise.reject('stream failed')
                  },
                  cancel() {
                    return Promise.resolve()
                  }
                }
              }
            }
          }
        }
      },
      {
        requestErrorResponseLengthLimit: 5
      },
      (responseText) => {
        expect(responseText).toBe('Unable to retrieve response: stream failed')
        done()
      }
    )
  })
})
