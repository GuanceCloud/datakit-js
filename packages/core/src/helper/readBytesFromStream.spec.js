import { readBytesFromStream } from './readBytesFromStream'

describe('readBytesFromStream', () => {
  function createStream(results, cancelReturn) {
    const reader = {
      read: jasmine.createSpy('read'),
      cancel: jasmine.createSpy('cancel').and.returnValue(cancelReturn)
    }

    let callIndex = 0
    reader.read.and.callFake(() => {
      const result = results[callIndex++]
      if (result && result.type === 'reject') {
        return Promise.reject(result.value)
      }
      return Promise.resolve(result)
    })

    return {
      stream: {
        getReader: () => reader
      },
      reader
    }
  }

  it('should collect bytes up to the limit and report when the limit is exceeded', (done) => {
    const firstChunk = new Uint8Array([1, 2])
    const secondChunk = new Uint8Array([3, 4])
    const { stream, reader } = createStream(
      [
        { done: false, value: firstChunk },
        { done: false, value: secondChunk }
      ],
      Promise.resolve()
    )

    readBytesFromStream(
      stream,
      (error, bytes, limitExceeded) => {
        expect(error).toBeUndefined()
        expect(Array.from(bytes)).toEqual([1, 2, 3])
        expect(limitExceeded).toBeTrue()
        expect(reader.cancel).toHaveBeenCalled()
        done()
      },
      { bytesLimit: 3, collectStreamBody: true }
    )
  })

  it('should concatenate a single chunk without extra copying when the stream ends', (done) => {
    const onlyChunk = new Uint8Array([7, 8, 9])
    const { stream } = createStream(
      [
        { done: false, value: onlyChunk },
        { done: true }
      ],
      Promise.resolve()
    )

    readBytesFromStream(
      stream,
      (error, bytes, limitExceeded) => {
        expect(error).toBeUndefined()
        expect(bytes).toEqual(new Uint8Array([7, 8, 9]))
        expect(limitExceeded).toBeFalse()
        done()
      },
      { bytesLimit: 10, collectStreamBody: true }
    )
  })

  it('should skip byte collection when collectStreamBody is disabled', (done) => {
    const { stream } = createStream(
      [
        { done: false, value: new Uint8Array([1, 2]) },
        { done: true }
      ],
      Promise.resolve()
    )

    readBytesFromStream(
      stream,
      (error, bytes, limitExceeded) => {
        expect(error).toBeUndefined()
        expect(bytes).toBeUndefined()
        expect(limitExceeded).toBeUndefined()
        done()
      },
      { bytesLimit: 10, collectStreamBody: false }
    )
  })

  it('should forward reader errors to the callback', (done) => {
    const expectedError = new Error('read failed')
    const { stream } = createStream(
      [{ type: 'reject', value: expectedError }],
      Promise.resolve()
    )

    readBytesFromStream(
      stream,
      (error) => {
        expect(error).toBe(expectedError)
        done()
      },
      { bytesLimit: 10, collectStreamBody: true }
    )
  })

  it('should swallow cancellation failures to avoid unhandled rejections', (done) => {
    const { stream, reader } = createStream(
      [
        { done: false, value: new Uint8Array([1]) },
        { done: true }
      ],
      Promise.reject(new Error('cancel failed'))
    )

    readBytesFromStream(
      stream,
      (error, bytes) => {
        expect(error).toBeUndefined()
        expect(Array.from(bytes)).toEqual([1])
        expect(reader.cancel).toHaveBeenCalled()
        done()
      },
      { bytesLimit: 10, collectStreamBody: true }
    )
  })
})
